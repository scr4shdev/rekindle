/**
 * FROZEN CONTRACT (Phase 0). Builders: do not edit. Request changes in TODO.md
 * with "BLOCKED: contract change needed".
 *
 * Single source of truth for runtime configuration. Every model id, URL, TTL,
 * timeout and limit lives here. Invalid values fail fast at load time; missing
 * API keys are NOT an error: the affected provider falls back to mock mode.
 *
 * Server-only. Never import from client components.
 */
import { z } from "zod";

export const LLM_PROVIDERS = ["anthropic", "gemini", "groq", "ollama"] as const;
export type LlmProviderName = (typeof LLM_PROVIDERS)[number];

/** Providers backed by a hosted API key. `ollama` is local-only. */
export const KEYED_LLM_PROVIDERS = ["gemini", "groq", "anthropic"] as const;
export type KeyedLlmProviderName = (typeof KEYED_LLM_PROVIDERS)[number];

/** Default Ollama endpoint and model for the local provider. */
export const OLLAMA_DEFAULT_BASE_URL = "http://127.0.0.1:11434";
export const OLLAMA_DEFAULT_MODEL = "qwen3:8b";

/** Pinned default model per provider. Override with LLM_MODEL. */
export const DEFAULT_LLM_MODELS: Record<LlmProviderName, string> = {
  gemini: "gemini-3.5-flash",
  groq: "openai/gpt-oss-120b",
  anthropic: "claude-haiku-4-5",
  ollama: OLLAMA_DEFAULT_MODEL,
};

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
   * anthropic | gemini | groq | ollama | mock. Unset: first provider with a
   * key (anthropic > gemini > groq), then ollama if reachable, else mock.
   * `REKINDLE_LLM_PROVIDER` is accepted as an alias for A/B testing.
   */
  LLM_PROVIDER: z.preprocess(emptyToUndefined, z.enum([...LLM_PROVIDERS, "mock"]).optional()),
  REKINDLE_LLM_PROVIDER: z.preprocess(emptyToUndefined, z.enum([...LLM_PROVIDERS, "mock"]).optional()),
  LLM_MODEL: optionalString,
  GEMINI_API_KEY: optionalSecret,
  GROQ_API_KEY: optionalSecret,
  ANTHROPIC_API_KEY: optionalSecret,
  OLLAMA_BASE_URL: z.preprocess(emptyToUndefined, z.url().default(OLLAMA_DEFAULT_BASE_URL)),
  OLLAMA_MODEL: optionalString,
  LLM_TIMEOUT_MS: int(30_000, 1_000, 120_000),
  LLM_MAX_RETRIES: int(1, 0, 5),
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
    /** "mock" when mode is mock. */
    provider: LlmProviderName | "mock";
    /** Pinned model id. "mock-llm" when mode is mock. */
    model: string;
    /** Hosted-provider API key. Undefined for the local Ollama provider and in mock mode. */
    apiKey?: string;
    /** Base URL for the local Ollama endpoint. Only meaningful when provider === "ollama". */
    ollamaBaseUrl?: string;
    /** Always 0: deterministic outputs. Not configurable on purpose. */
    temperature: 0;
    timeoutMs: number;
    maxRetries: number;
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

const KEY_BY_PROVIDER = {
  gemini: "GEMINI_API_KEY",
  groq: "GROQ_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
} as const satisfies Record<KeyedLlmProviderName, keyof z.infer<typeof EnvSchema>>;

/** Hosted preference order when auto-picking a provider by API key. */
const KEYED_AUTO_ORDER: readonly KeyedLlmProviderName[] = ["anthropic", "gemini", "groq"];

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

  // REKINDLE_LLM_PROVIDER wins over LLM_PROVIDER (explicit A/B override).
  const requested = e.REKINDLE_LLM_PROVIDER ?? e.LLM_PROVIDER;
  // Auto-pick only looks at keyed providers; Ollama is a composition-time fallback
  // chosen when it is actually reachable.
  const autoProvider = KEYED_AUTO_ORDER.find((p) => Boolean(e[KEY_BY_PROVIDER[p]]));
  const provider: LlmProviderName | undefined =
    requested === "mock" ? undefined : (requested ?? autoProvider);
  const apiKey =
    provider && provider !== "ollama" ? e[KEY_BY_PROVIDER[provider as KeyedLlmProviderName]] : undefined;
  // Ollama needs no API key: being chosen is enough. Reachability is checked at composition time.
  const needsKey = provider !== undefined && provider !== "ollama";
  const llmLive = !forced && provider !== undefined && (!needsKey || Boolean(apiKey));
  const llmCommon = {
    temperature: 0 as const,
    timeoutMs: e.LLM_TIMEOUT_MS,
    maxRetries: e.LLM_MAX_RETRIES,
    cacheTtlSeconds: e.LLM_CACHE_TTL_SECONDS,
  };
  const llm: AppConfig["llm"] = llmLive
    ? {
        mode: "live",
        provider: provider!,
        model: e.LLM_MODEL ?? (provider === "ollama" ? (e.OLLAMA_MODEL ?? OLLAMA_DEFAULT_MODEL) : DEFAULT_LLM_MODELS[provider!]),
        apiKey,
        ollamaBaseUrl: provider === "ollama" ? e.OLLAMA_BASE_URL.replace(/\/+$/, "") : undefined,
        ...llmCommon,
      }
    : {
        mode: "mock",
        mockReason: forced ? "forced" : requested === "mock" ? "configured" : "missing_key",
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
