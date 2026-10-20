/**
 * Single source of truth for runtime configuration. Every model id, URL, TTL,
 * timeout and limit lives here. Invalid values fail fast at load time; missing
 * API keys are NOT an error: the affected provider falls back to mock mode.
 *
 * The LLM layer is OpenAI-compatible-only: both Gemini and Ollama expose an
 * OpenAI chat-completions endpoint, so we hold one adapter and swap backends by
 * `baseUrl` + `apiKey`. See `src/lib/adapters/llm/ai-sdk.ts` and
 * `src/lib/composition.ts`.
 *
 * Server-only. Never import from client components.
 */
import { z } from "zod";

/** Backends we accept as the active LLM provider. Both speak OpenAI chat-completions. */
export const LLM_PROVIDERS = ["gemini", "ollama"] as const;
export type LlmProviderName = (typeof LLM_PROVIDERS)[number];

/** Default Ollama endpoint and model for the local provider. */
export const OLLAMA_DEFAULT_BASE_URL = "http://127.0.0.1:11434";
export const OLLAMA_DEFAULT_MODEL = "qwen3:8b";

/** Gemini's OpenAI-compatible endpoint root (no `/chat/completions` suffix: AI SDK appends it). */
export const GEMINI_OPENAI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";

/** Default model id when `LLM_MODEL` is not set. Points at the quota-cleared Gemini model. */
export const DEFAULT_LLM_MODEL = "gemini-3.1-flash-lite";

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optionalSecret = z.preprocess(emptyToUndefined, z.string().min(8).optional());
const optionalString = z.preprocess(emptyToUndefined, z.string().optional());
const optionalUrl = z.preprocess(emptyToUndefined, z.url().optional());
const bool = (def: boolean) =>
  z.preprocess(emptyToUndefined, z.enum(["true", "false", "1", "0"]).optional()).transform((v) =>
    v === undefined ? def : v === "true" || v === "1",
  );
const int = (def: number, min: number, max: number) =>
  z.preprocess(emptyToUndefined, z.coerce.number().int().min(min).max(max).optional()).transform((v) => v ?? def);

/** Integer env var that is clamped into [min, max] instead of rejected (unparseable values still fail fast). */
const clampedInt = (def: number, min: number, max: number) =>
  z
    .preprocess(emptyToUndefined, z.coerce.number().int().optional())
    .transform((v) => Math.min(max, Math.max(min, v ?? def)));

/** Raw environment schema. Names here are the documented env vars (see .env.example). */
const EnvSchema = z.object({
  NODE_ENV: z.preprocess(emptyToUndefined, z.enum(["development", "production", "test"]).default("development")),
  LOG_LEVEL: z.preprocess(
    emptyToUndefined,
    z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  ),
  /** Forces every adapter into mock mode even when keys are present (tests, E2E, demos). */
  REKINDLE_FORCE_MOCK: bool(false),

  QLOO_API_KEY: optionalSecret,
  QLOO_BASE_URL: z.preprocess(emptyToUndefined, z.url().default("https://hackathon.api.qloo.com")),
  QLOO_TIMEOUT_MS: int(8_000, 500, 30_000),
  QLOO_MAX_RETRIES: int(2, 0, 5),
  QLOO_DEFAULT_TAKE: int(10, 1, 50),
  QLOO_CACHE_TTL_SECONDS: int(60 * 60 * 24 * 7, 0, 60 * 60 * 24 * 30),

  /**
   * Optional preference: "gemini" (default) or "ollama". Unset: pick Gemini
   * when `GEMINI_API_KEY` is present, otherwise fall through to Ollama if the
   * local endpoint answers.
   */
  LLM_PROVIDER: z.preprocess(emptyToUndefined, z.enum([...LLM_PROVIDERS]).optional()),
  LLM_MODEL: optionalString,
  /** Overrides the derived base URL (useful behind a proxy or custom OpenAI-compat gateway). */
  LLM_BASE_URL_OVERRIDE: optionalUrl,
  GEMINI_API_KEY: optionalSecret,
  OLLAMA_BASE_URL: z.preprocess(emptyToUndefined, z.url().default(OLLAMA_DEFAULT_BASE_URL)),
  LLM_TIMEOUT_MS: int(30_000, 1_000, 120_000),
  /** Retries for the TTS adapter. The LLM adapter uses LLM_RETRY_* below. */
  LLM_MAX_RETRIES: int(1, 0, 5),
  /** Total LLM attempts (first call included) for transient failures. Clamped to 1..5. */
  LLM_RETRY_MAX_ATTEMPTS: clampedInt(3, 1, 5),
  /** Base backoff before the first LLM retry; later retries multiply by 4. Clamped to 0..5000. */
  LLM_RETRY_BASE_DELAY_MS: clampedInt(500, 0, 5_000),
  LLM_CACHE_TTL_SECONDS: int(60 * 60 * 24 * 7, 0, 60 * 60 * 24 * 30),

  UPSTASH_REDIS_REST_URL: optionalUrl,
  UPSTASH_REDIS_REST_TOKEN: optionalSecret,

  /** Session-planning knobs. */
  FORMATIVE_AGE_MIN: int(10, 0, 40),
  FORMATIVE_AGE_MAX: int(30, 10, 60),
  MAX_CANDIDATES_PER_DOMAIN: int(5, 1, 15),
  MAX_EXPANSIONS_PER_DOMAIN: int(4, 0, 15),
  MAX_SESSION_STEPS: int(8, 3, 15),
  /** Serverless route budget (Vercel Hobby). Agent must finish or degrade before this. */
  AGENT_DEADLINE_MS: int(55_000, 5_000, 300_000),
});

export type ProviderMode = "live" | "mock";

export interface AppConfig {
  env: "development" | "production" | "test";
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
  qloo: {
    mode: ProviderMode;
    /** Why mock mode was chosen, for the startup log / UI badge. */
    mockReason?: "forced" | "missing_key";
    apiKey?: string;
    baseUrl: string;
    timeoutMs: number;
    maxRetries: number;
    defaultTake: number;
    cacheTtlSeconds: number;
  };
  llm: {
    mode: ProviderMode;
    mockReason?: "forced" | "missing_key" | "configured" | "unreachable";
    /** Explicit preference, when set, before composition's reachability probe. */
    preferred?: LlmProviderName;
    /**
     * Resolved provider label for logs/health. In mock mode it is "mock".
     * The actual chosen backend may still shift to "ollama" at composition time
     * when Gemini is unavailable and Ollama responds.
     */
    provider: LlmProviderName | "mock";
    /** Pinned model id. "mock-llm" when mode is mock. */
    model: string;
    /** Gemini key when present. Undefined for Ollama and in mock mode. */
    apiKey?: string;
    /** Local Ollama base URL, always set so composition can probe it. */
    ollamaBaseUrl: string;
    /** Optional base URL override that short-circuits provider selection in the adapter. */
    baseUrlOverride?: string;
    /** Always 0: deterministic outputs. Not configurable on purpose. */
    temperature: 0;
    timeoutMs: number;
    /** Retries for the TTS adapter only. */
    maxRetries: number;
    /** Bounded retry policy for transient LLM failures (5xx, 429, network, empty output). */
    retry: { maxAttempts: number; baseDelayMs: number };
    cacheTtlSeconds: number;
  };
  cache: {
    driver: "memory" | "upstash";
    upstashUrl?: string;
    upstashToken?: string;
    /** Bump to invalidate every cached entry after a breaking change. */
    keyPrefix: string;
  };
  agent: {
    formativeAgeMin: number;
    formativeAgeMax: number;
    maxCandidatesPerDomain: number;
    maxExpansionsPerDomain: number;
    maxSessionSteps: number;
    deadlineMs: number;
  };
}

export class ConfigError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid configuration:\n- ${issues.join("\n- ")}`);
    this.name = "ConfigError";
  }
}

/** Pure: parse an env record into AppConfig. Throws ConfigError on invalid values. */
export function loadConfig(source: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    // Report variable names and messages only; never echo values (they may be secrets).
    throw new ConfigError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  }
  const e = parsed.data;
  if (e.FORMATIVE_AGE_MIN >= e.FORMATIVE_AGE_MAX) {
    throw new ConfigError(["FORMATIVE_AGE_MIN must be lower than FORMATIVE_AGE_MAX"]);
  }
  if (Boolean(e.UPSTASH_REDIS_REST_URL) !== Boolean(e.UPSTASH_REDIS_REST_TOKEN)) {
    throw new ConfigError(["UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set together"]);
  }

  const forced = e.REKINDLE_FORCE_MOCK;

  const qlooLive = !forced && Boolean(e.QLOO_API_KEY);
  const qloo: AppConfig["qloo"] = {
    mode: qlooLive ? "live" : "mock",
    mockReason: qlooLive ? undefined : forced ? "forced" : "missing_key",
    apiKey: qlooLive ? e.QLOO_API_KEY : undefined,
    baseUrl: e.QLOO_BASE_URL.replace(/\/+$/, ""),
    timeoutMs: e.QLOO_TIMEOUT_MS,
    maxRetries: e.QLOO_MAX_RETRIES,
    defaultTake: e.QLOO_DEFAULT_TAKE,
    cacheTtlSeconds: e.QLOO_CACHE_TTL_SECONDS,
  };

  const preferred = e.LLM_PROVIDER;
  // When the user did not force mock and either (a) Gemini is keyed or (b)
  // they explicitly asked for Ollama, we are "live" at config load. The actual
  // backend selection happens in composition, which may still reject the mode
  // (no Gemini key, no Ollama reachable) and raise LlmNotConfiguredError.
  const hasGemini = Boolean(e.GEMINI_API_KEY);
  const canStartLive = !forced && (hasGemini || preferred === "ollama");

  const ollamaBaseUrl = e.OLLAMA_BASE_URL.replace(/\/+$/, "");
  // Model default: if the user chose Ollama explicitly, default to the local
  // model id; otherwise default to the Gemini model id.
  const model = e.LLM_MODEL ?? (preferred === "ollama" ? OLLAMA_DEFAULT_MODEL : DEFAULT_LLM_MODEL);

  const llmCommon = {
    temperature: 0 as const,
    timeoutMs: e.LLM_TIMEOUT_MS,
    maxRetries: e.LLM_MAX_RETRIES,
    retry: { maxAttempts: e.LLM_RETRY_MAX_ATTEMPTS, baseDelayMs: e.LLM_RETRY_BASE_DELAY_MS },
    cacheTtlSeconds: e.LLM_CACHE_TTL_SECONDS,
    ollamaBaseUrl,
    baseUrlOverride: e.LLM_BASE_URL_OVERRIDE,
  };

  const llm: AppConfig["llm"] = canStartLive
    ? {
        mode: "live",
        preferred,
        // When no explicit preference is set we start out labelled as the
        // backend we'd pick first (Gemini when its key is present).
        provider: preferred ?? (hasGemini ? "gemini" : "ollama"),
        model,
        apiKey: hasGemini ? e.GEMINI_API_KEY : undefined,
        ...llmCommon,
      }
    : {
        mode: "mock",
        mockReason: forced ? "forced" : "missing_key",
        provider: "mock",
        model: "mock-llm",
        ...llmCommon,
      };

  const upstash = Boolean(e.UPSTASH_REDIS_REST_URL && e.UPSTASH_REDIS_REST_TOKEN) && !forced;
  const cache: AppConfig["cache"] = upstash
    ? { driver: "upstash", upstashUrl: e.UPSTASH_REDIS_REST_URL, upstashToken: e.UPSTASH_REDIS_REST_TOKEN, keyPrefix: "rekindle:v1" }
    : { driver: "memory", keyPrefix: "rekindle:v1" };

  return {
    env: e.NODE_ENV,
    logLevel: e.LOG_LEVEL,
    qloo,
    llm,
    cache,
    agent: {
      formativeAgeMin: e.FORMATIVE_AGE_MIN,
      formativeAgeMax: e.FORMATIVE_AGE_MAX,
      maxCandidatesPerDomain: e.MAX_CANDIDATES_PER_DOMAIN,
      maxExpansionsPerDomain: e.MAX_EXPANSIONS_PER_DOMAIN,
      maxSessionSteps: e.MAX_SESSION_STEPS,
      deadlineMs: e.AGENT_DEADLINE_MS,
    },
  };
}

let cached: AppConfig | undefined;

/** Memoized config for the current process (one per serverless instance). */
export function getConfig(): AppConfig {
  cached ??= loadConfig();
  return cached;
}

/** Non-secret view of the config, safe to log or expose via a /api/health route. */
export function publicConfigSummary(c: AppConfig = getConfig()) {
  return {
    qloo: { mode: c.qloo.mode, mockReason: c.qloo.mockReason, baseUrl: c.qloo.baseUrl },
    llm: { mode: c.llm.mode, mockReason: c.llm.mockReason, provider: c.llm.provider, model: c.llm.model },
    cache: { driver: c.cache.driver },
  };
}
