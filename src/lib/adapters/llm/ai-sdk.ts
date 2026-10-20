/**
 * Live LLM adapter on the Vercel AI SDK 7: `generateText` + `Output.object` at
 * temperature 0 with the pinned model from config. We talk to any
 * OpenAI-compatible chat-completions endpoint; the current repo switches
 * between Gemini's OpenAI-compat endpoint and local Ollama's by swapping
 * `baseUrl` and `apiKey` in `AiSdkLlmConfig`. One happy path for both.
 *
 * Cache-through on an input-keyed sha256 key; `sensitive` requests stay in
 * memory-only caches (enforced by the cache adapters).
 */
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { APICallError, generateText, NoObjectGeneratedError, Output, TypeValidationError } from "ai";

import type { CachePort } from "@/lib/ports/cache";
import { buildCacheKey } from "@/lib/ports/cache";
import type { CallContext } from "@/lib/ports/common";
import { PortError } from "@/lib/ports/common";
import type { LlmPort, LlmRequest, LlmResult } from "@/lib/ports/llm";

import type { Sleep } from "@/lib/adapters/shared/backoff";
import { abortableSleep, backoffMs } from "@/lib/adapters/shared/backoff";

/**
 * The adapter is backend-agnostic: it carries only an OpenAI-compat baseUrl +
 * api key + model id. The composition root supplies these per backend. Both
 * Gemini's OpenAI-compat endpoint and Ollama's accept the same chat-completions
 * schema, so this struct does not branch on provider.
 */
export interface AiSdkLlmConfig {
  /** Short tag used in logs and the `LlmPort.provider` field (e.g. "gemini", "ollama"). */
  provider: string;
  /** Model id to pass through to the OpenAI-compat endpoint (e.g. "gemini-3.1-flash-lite", "qwen3:8b"). */
  model: string;
  /** OpenAI-compat chat-completions root (no `/chat/completions` suffix: AI SDK appends it). */
  baseUrl: string;
  /** API key for `Authorization: Bearer`. Pass `"ollama"` (or any non-empty value) for local Ollama. */
  apiKey: string;
  temperature: 0;
  timeoutMs: number;
  maxRetries: number;
  cacheTtlSeconds: number;
}

/** Build an AI-SDK LanguageModel against any OpenAI-compat endpoint. */
export function createLanguageModel(config: AiSdkLlmConfig): LanguageModel {
  // `name` is the provider label the AI SDK stamps into APICallError / telemetry;
  // "openai-compat" is explicit about the fact we're not pointing at openai.com.
  const provider = createOpenAI({
    name: "openai-compat",
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
  });
  // `provider(id)` defaults to the OpenAI Responses API; third-party
  // OpenAI-compat endpoints (Gemini, Ollama, most gateways) only ship the
  // chat-completions path, so we pin to `.chat()`.
  return provider.chat(config.model);
}

/** Cache key for one structured call. The prompt id is part of the input so two prompts never collide. */
export function llmCacheKey(provider: string, model: string, request: LlmRequest<unknown>, prefix?: string): string {
  return buildCacheKey(
    { provider, model, promptVersion: request.version, input: { promptId: request.promptId, input: request.input } },
    prefix,
  );
}

/** Extract just the host from a URL for logging, so we never spill the full path or query. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "unknown";
  }
}

export class AiSdkLlm implements LlmPort {
  readonly mode = "live" as const;
  readonly provider: string;
  readonly model: string;
  private readonly languageModel: LanguageModel;
  private readonly baseUrlHost: string;
  private readonly keyPrefix?: string;
  private readonly sleep: Sleep;

  constructor(
    private readonly config: AiSdkLlmConfig,
    private readonly cache: CachePort,
    options: { languageModel?: LanguageModel; keyPrefix?: string; sleep?: Sleep } = {},
  ) {
    this.provider = config.provider;
    this.model = config.model;
    this.languageModel = options.languageModel ?? createLanguageModel(config);
    this.baseUrlHost = hostOf(config.baseUrl);
    this.keyPrefix = options.keyPrefix;
    this.sleep = options.sleep ?? abortableSleep;
  }

  async generateObject<T>(request: LlmRequest<T>, ctx: CallContext): Promise<LlmResult<T>> {
    const started = Date.now();
    const log = ctx.logger.child({
      port: "llm",
      promptId: request.promptId,
      version: request.version,
      // Host only, so logs tell us which backend served the call without
      // leaking the full endpoint or the API key path.
      backendHost: this.baseUrlHost,
    });
    const key = llmCacheKey(this.provider, this.model, request as LlmRequest<unknown>, this.keyPrefix);

    const hit = await this.cache.get<unknown>(key);
    if (hit !== undefined) {
      const parsed = request.schema.safeParse(hit);
      if (parsed.success) {
        const latencyMs = Date.now() - started;
        log.info({ cached: true, latencyMs }, "llm call");
        return { object: parsed.data, cached: true, provider: this.provider, model: this.model, latencyMs };
      }
    }

    const attempts = this.config.maxRetries + 1;
    let lastError: PortError | undefined;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (ctx.signal?.aborted) throw new PortError("llm", "timeout", "The language model call was cancelled", false);
      const timeout = AbortSignal.timeout(this.config.timeoutMs);
      const signal = ctx.signal ? AbortSignal.any([ctx.signal, timeout]) : timeout;
      try {
        const result = await generateText({
          model: this.languageModel,
          instructions: request.system,
          prompt: request.prompt,
          output: Output.object({ schema: request.schema, name: request.promptId }),
          temperature: this.config.temperature,
          // Retries are handled here so schema mismatches are retried too.
          maxRetries: 0,
          abortSignal: signal,
        });
        const object = request.schema.parse(result.output);
        await this.cache.set(key, object, { ttlSeconds: this.config.cacheTtlSeconds, sensitive: request.sensitive });
        const latencyMs = Date.now() - started;
        const usage = { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens };
        log.info({ cached: false, latencyMs, attempt, ...usage }, "llm call");
        return { object, cached: false, provider: this.provider, model: this.model, latencyMs, usage };
      } catch (error) {
        lastError = toPortError(error, timeout.aborted && !ctx.signal?.aborted);
        // Status is the only extra signal worth logging: it tells us whether
        // Gemini / Ollama rejected the schema (400), the key (401), the model
        // (404) or is just overloaded (429/5xx). The response body may echo
        // request content, so we never log it.
        const status = APICallError.isInstance(error) ? error.statusCode : undefined;
        log.warn({ attempt, code: lastError.code, retryable: lastError.retryable, status }, "llm call failed");
        if (!lastError.retryable || ctx.signal?.aborted) break;
        if (attempt < attempts) await this.sleep(backoffMs(attempt), ctx.signal);
      }
    }
    throw lastError ?? new PortError("llm", "unavailable", "The language model is unavailable", true);
  }
}

/** Map AI SDK and provider errors to PortError. Messages are generic: provider messages may echo prompt content. */
export function toPortError(error: unknown, timedOut = false): PortError {
  if (error instanceof PortError) return error;
  if (timedOut) return new PortError("llm", "timeout", "The language model took too long", true, { cause: error });
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return new PortError("llm", "timeout", "The language model call was cancelled", false, { cause: error });
  }
  if (APICallError.isInstance(error)) {
    const status = error.statusCode ?? 0;
    if (status === 401 || status === 403) return new PortError("llm", "unauthorized", "The language model rejected the credentials", false, { cause: error });
    if (status === 429) return new PortError("llm", "rate_limited", "The language model is rate limited", true, { cause: error });
    if (status === 400) return new PortError("llm", "bad_request", "The language model rejected the request", false, { cause: error });
    return new PortError("llm", "unavailable", "The language model is unavailable", error.isRetryable || status >= 500, { cause: error });
  }
  if (NoObjectGeneratedError.isInstance(error) || TypeValidationError.isInstance(error) || isZodError(error)) {
    return new PortError("llm", "invalid_response", "The language model returned an invalid structure", true, { cause: error });
  }
  return new PortError("llm", "unavailable", "The language model is unavailable", true, { cause: error });
}

function isZodError(error: unknown): boolean {
  return error instanceof Error && error.name === "ZodError";
}
