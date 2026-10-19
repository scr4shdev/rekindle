/**
 * Live LLM adapter for a local Ollama server (`POST /api/chat`), hand-rolled
 * on fetch.
 *
 * We considered the Vercel AI SDK's OpenAI-compatible path (@ai-sdk/openai
 * with baseURL=http://127.0.0.1:11434/v1), but that package is not installed
 * in this repo and AGENTS.md forbids editing package.json. The native Ollama
 * /api/chat endpoint also exposes knobs the OpenAI path hides behind
 * provider-specific extras: `think: false` to disable qwen3's `<think>...</think>`
 * reasoning stream (which otherwise breaks structured JSON output), `format: <JSON schema>`
 * built from the prompt's zod schema (Ollama >= 0.5 supports this), and an
 * `options.seed` for reproducibility. Determinism is verified by
 * scripts/ollama-probe.probe.ts.
 *
 * Temperature 0, pinned model id, cache-through on an input-keyed sha256 key,
 * retries only on 5xx and connection errors.
 */
import { z } from "zod";

import type { AppConfig } from "@/lib/config";
import type { CachePort } from "@/lib/ports/cache";
import { buildCacheKey } from "@/lib/ports/cache";
import type { CallContext } from "@/lib/ports/common";
import { PortError } from "@/lib/ports/common";
import type { LlmPort, LlmRequest, LlmResult } from "@/lib/ports/llm";

import type { Sleep } from "@/lib/adapters/shared/backoff";
import { abortableSleep, backoffMs } from "@/lib/adapters/shared/backoff";

/** Deterministic seed for every Ollama call. Not configurable on purpose. */
export const OLLAMA_SEED = 42;
/**
 * Context window; Ollama allocates up to this many tokens per call.
 * 8192 keeps a Q4 8B model (and its Q8 KV cache) fully in a 6 GB GPU on this
 * box; qwen3's reasoning is disabled and Rekindle prompts are short, so we
 * never approach this limit in practice.
 */
export const OLLAMA_NUM_CTX = 8_192;

export type LiveOllamaConfig = AppConfig["llm"] & {
  provider: "ollama";
  baseUrl: string;
};

/** Shape of the Ollama /api/chat non-streaming response we rely on. */
interface OllamaChatResponse {
  model: string;
  message: { role: string; content: string };
  done: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
}

export type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

/** Cache key for one structured call. Mirrors the AI-SDK adapter's key shape. */
export function ollamaCacheKey(
  provider: string,
  model: string,
  request: LlmRequest<unknown>,
  prefix?: string,
): string {
  return buildCacheKey(
    { provider, model, promptVersion: request.version, input: { promptId: request.promptId, input: request.input } },
    prefix,
  );
}

/** Compact zod -> JSON schema conversion for Ollama's `format` parameter. */
export function schemaToJsonSchema(schema: z.ZodType<unknown>): Record<string, unknown> {
  // zod 4 ships a native converter that produces draft-2020-12 schemas.
  const converted = z.toJSONSchema(schema, { target: "draft-2020-12" }) as Record<string, unknown>;
  // Ollama rejects top-level $schema; strip it.
  const { $schema: _schema, ...rest } = converted;
  void _schema;
  return rest;
}

export class OllamaLlm implements LlmPort {
  readonly mode = "live" as const;
  readonly provider = "ollama";
  readonly model: string;
  private readonly baseUrl: string;
  private readonly fetcher: Fetcher;
  private readonly sleep: Sleep;
  private readonly keyPrefix?: string;

  constructor(
    private readonly config: LiveOllamaConfig,
    private readonly cache: CachePort,
    options: { fetcher?: Fetcher; sleep?: Sleep; keyPrefix?: string } = {},
  ) {
    this.model = config.model;
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.fetcher = options.fetcher ?? ((url, init) => fetch(url, init));
    this.sleep = options.sleep ?? abortableSleep;
    this.keyPrefix = options.keyPrefix;
  }

  async generateObject<T>(request: LlmRequest<T>, ctx: CallContext): Promise<LlmResult<T>> {
    const started = Date.now();
    const log = ctx.logger.child({ port: "llm", promptId: request.promptId, version: request.version });
    const key = ollamaCacheKey(this.provider, this.model, request as LlmRequest<unknown>, this.keyPrefix);

    const hit = await this.cache.get<unknown>(key);
    if (hit !== undefined) {
      const parsed = request.schema.safeParse(hit);
      if (parsed.success) {
        const latencyMs = Date.now() - started;
        log.info({ cached: true, latencyMs }, "llm call");
        return { object: parsed.data, cached: true, provider: this.provider, model: this.model, latencyMs };
      }
    }

    const format = schemaToJsonSchema(request.schema as z.ZodType<unknown>);
    const body = {
      model: this.model,
      stream: false,
      // qwen3 ships with "thinking" mode on by default; disable it for deterministic JSON.
      think: false,
      format,
      options: {
        temperature: this.config.temperature,
        seed: OLLAMA_SEED,
        num_ctx: OLLAMA_NUM_CTX,
      },
      messages: [
        { role: "system", content: request.system },
        { role: "user", content: request.prompt },
      ],
    } as const;

    const attempts = this.config.maxRetries + 1;
    let lastError: PortError | undefined;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (ctx.signal?.aborted) {
        throw new PortError("llm", "timeout", "The language model call was cancelled", false);
      }
      const timeout = AbortSignal.timeout(this.config.timeoutMs);
      const signal = ctx.signal ? AbortSignal.any([ctx.signal, timeout]) : timeout;
      try {
        const res = await this.fetcher(`${this.baseUrl}/api/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal,
        });
        if (!res.ok) {
          lastError = httpError(res.status);
          log.warn({ attempt, status: res.status, retryable: lastError.retryable }, "llm call failed");
          if (!lastError.retryable || ctx.signal?.aborted) break;
          if (attempt < attempts) await this.sleep(backoffMs(attempt), ctx.signal);
          continue;
        }
        const data = (await res.json()) as OllamaChatResponse;
        const content = data?.message?.content;
        if (typeof content !== "string" || content.length === 0) {
          lastError = new PortError("llm", "invalid_response", "The language model returned no content", true);
          log.warn({ attempt, code: lastError.code }, "llm call failed");
          if (attempt < attempts) await this.sleep(backoffMs(attempt), ctx.signal);
          continue;
        }
        let parsedJson: unknown;
        try {
          parsedJson = JSON.parse(content);
        } catch {
          lastError = new PortError("llm", "invalid_response", "The language model did not return JSON", true);
          log.warn({ attempt, code: lastError.code }, "llm call failed");
          if (attempt < attempts) await this.sleep(backoffMs(attempt), ctx.signal);
          continue;
        }
        const parsed = request.schema.safeParse(parsedJson);
        if (!parsed.success) {
          lastError = new PortError("llm", "invalid_response", "The language model returned an invalid structure", true);
          log.warn({ attempt, code: lastError.code }, "llm call failed");
          if (attempt < attempts) await this.sleep(backoffMs(attempt), ctx.signal);
          continue;
        }
        await this.cache.set(key, parsed.data, {
          ttlSeconds: this.config.cacheTtlSeconds,
          sensitive: request.sensitive,
        });
        const latencyMs = Date.now() - started;
        const usage = {
          inputTokens: data.prompt_eval_count,
          outputTokens: data.eval_count,
        };
        log.info({ cached: false, latencyMs, attempt, ...usage }, "llm call");
        return {
          object: parsed.data,
          cached: false,
          provider: this.provider,
          model: this.model,
          latencyMs,
          usage,
        };
      } catch (error) {
        lastError = toPortError(error, timeout.aborted && !ctx.signal?.aborted);
        log.warn({ attempt, code: lastError.code, retryable: lastError.retryable }, "llm call failed");
        if (!lastError.retryable || ctx.signal?.aborted) break;
        if (attempt < attempts) await this.sleep(backoffMs(attempt), ctx.signal);
      }
    }
    throw lastError ?? new PortError("llm", "unavailable", "The language model is unavailable", true);
  }
}

/** Map an HTTP status to a PortError. */
function httpError(status: number): PortError {
  if (status === 401 || status === 403) {
    return new PortError("llm", "unauthorized", "The language model rejected the credentials", false);
  }
  if (status === 429) {
    return new PortError("llm", "rate_limited", "The language model is rate limited", true);
  }
  if (status === 400) {
    return new PortError("llm", "bad_request", "The language model rejected the request", false);
  }
  return new PortError("llm", "unavailable", "The language model is unavailable", status >= 500);
}

/** Map fetch/connection errors to PortError. */
export function toPortError(error: unknown, timedOut = false): PortError {
  if (error instanceof PortError) return error;
  if (timedOut) {
    return new PortError("llm", "timeout", "The language model took too long", true, { cause: error });
  }
  if (error instanceof Error) {
    if (error.name === "AbortError" || error.name === "TimeoutError") {
      return new PortError("llm", "timeout", "The language model call was cancelled", false, { cause: error });
    }
    // fetch failures (ECONNREFUSED, DNS, etc.) throw TypeError in Node.
    if (error.name === "TypeError") {
      return new PortError("llm", "unavailable", "The language model is unavailable", true, { cause: error });
    }
  }
  return new PortError("llm", "unavailable", "The language model is unavailable", true, { cause: error });
}

/**
 * Lightweight reachability probe used by composition to decide the Ollama
 * fallback. One short GET /api/tags with a bounded timeout; never throws.
 */
export async function isOllamaReachable(
  baseUrl: string,
  options: { timeoutMs?: number; fetcher?: Fetcher } = {},
): Promise<boolean> {
  const { timeoutMs = 1_500, fetcher = (url, init) => fetch(url, init) } = options;
  const url = `${baseUrl.replace(/\/+$/, "")}/api/tags`;
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const res = await fetcher(url, { method: "GET", signal });
    return res.ok;
  } catch {
    return false;
  }
}
