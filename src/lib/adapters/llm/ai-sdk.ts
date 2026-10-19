/**
 * Live LLM adapter on the Vercel AI SDK 7: `generateText` + `Output.object`
 * at temperature 0 with the pinned model from config. Cache-through on an
 * input-keyed sha256 key; `sensitive` requests stay in memory-only caches
 * (enforced by the cache adapters).
 */
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import type { LanguageModel } from "ai";
import { APICallError, generateText, NoObjectGeneratedError, Output, TypeValidationError } from "ai";

import type { AppConfig, KeyedLlmProviderName } from "@/lib/config";
import type { CachePort } from "@/lib/ports/cache";
import { buildCacheKey } from "@/lib/ports/cache";
import type { CallContext } from "@/lib/ports/common";
import { PortError } from "@/lib/ports/common";
import type { LlmPort, LlmRequest, LlmResult } from "@/lib/ports/llm";

import type { Sleep } from "@/lib/adapters/shared/backoff";
import { abortableSleep, backoffMs } from "@/lib/adapters/shared/backoff";

export type LiveLlmConfig = AppConfig["llm"] & { provider: KeyedLlmProviderName };

/** Build the provider model from config. The API key is passed explicitly (never read from env here). */
export function createLanguageModel(config: LiveLlmConfig): LanguageModel {
  switch (config.provider) {
    case "gemini":
      return createGoogleGenerativeAI({ apiKey: config.apiKey })(config.model);
    case "groq":
      return createGroq({ apiKey: config.apiKey })(config.model);
    case "anthropic":
      return createAnthropic({ apiKey: config.apiKey })(config.model);
  }
}

/** Cache key for one structured call. The prompt id is part of the input so two prompts never collide. */
export function llmCacheKey(provider: string, model: string, request: LlmRequest<unknown>, prefix?: string): string {
  return buildCacheKey(
    { provider, model, promptVersion: request.version, input: { promptId: request.promptId, input: request.input } },
    prefix,
  );
}

export class AiSdkLlm implements LlmPort {
  readonly mode = "live" as const;
  readonly provider: string;
  readonly model: string;
  private readonly languageModel: LanguageModel;
  private readonly keyPrefix?: string;
  private readonly sleep: Sleep;

  constructor(
    private readonly config: LiveLlmConfig,
    private readonly cache: CachePort,
    options: { languageModel?: LanguageModel; keyPrefix?: string; sleep?: Sleep } = {},
  ) {
    this.provider = config.provider;
    this.model = config.model;
    this.languageModel = options.languageModel ?? createLanguageModel(config);
    this.keyPrefix = options.keyPrefix;
    this.sleep = options.sleep ?? abortableSleep;
  }

  async generateObject<T>(request: LlmRequest<T>, ctx: CallContext): Promise<LlmResult<T>> {
    const started = Date.now();
    const log = ctx.logger.child({ port: "llm", promptId: request.promptId, version: request.version });
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
        log.warn({ attempt, code: lastError.code, retryable: lastError.retryable }, "llm call failed");
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
