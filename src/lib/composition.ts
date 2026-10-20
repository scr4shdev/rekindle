/**
 * Composition root: the single place that reads config and wires adapters
 * into AgentDeps. One instance per serverless instance (warm invocations
 * share the in-memory cache). Server-only.
 *
 * The LLM layer is OpenAI-compat-only. Both Gemini and Ollama ship an
 * OpenAI chat-completions endpoint, so one adapter talks to both and we
 * pick a backend by `baseUrl` + `apiKey`. Fall-through order:
 *
 *   1. GEMINI_API_KEY set AND LLM_PROVIDER !== "ollama"  -> Gemini.
 *   2. Ollama reachable at OLLAMA_BASE_URL              -> Ollama.
 *   3. Else                                             -> throw LlmNotConfiguredError.
 */
import { Redis } from "@upstash/redis";
import { nanoid } from "nanoid";

import { LayeredCache, MemoryCache, UpstashCache } from "@/lib/adapters/cache";
import type { AiSdkLlmConfig } from "@/lib/adapters/llm/ai-sdk";
import { AiSdkLlm } from "@/lib/adapters/llm/ai-sdk";
import { QlooHttp } from "@/lib/adapters/qloo/http";
import { MockQloo } from "@/lib/adapters/qloo/mock";
import { GEMINI_TTS_MODEL, GeminiTts } from "@/lib/adapters/tts/gemini";
import { MockTts } from "@/lib/adapters/tts/mock";
import type { AppConfig } from "@/lib/config";
import { GEMINI_OPENAI_BASE_URL, getConfig } from "@/lib/config";
import { getLogger } from "@/lib/logger";
import type { AgentDeps, CachePort, LlmPort, TastePort, TtsPort } from "@/lib/ports";

/** Simulated latency of the Qloo mock outside tests, so the demo trace streams at a readable pace. */
export const MOCK_LATENCY_MS = { qloo: 60 } as const;

/** Ollama's OpenAI-compat endpoint lives under /v1 of the Ollama server root. */
export const OLLAMA_OPENAI_SUFFIX = "/v1";

/** Reachability probe timeout. Short so we never block the cold-start path. */
export const OLLAMA_PROBE_TIMEOUT_MS = 1500;

export class LlmNotConfiguredError extends Error {
  constructor(reason: string) {
    super(`No LLM backend available: ${reason}`);
    this.name = "LlmNotConfiguredError";
  }
}

export function buildCache(config: AppConfig): CachePort {
  const memory = new MemoryCache();
  if (config.cache.driver !== "upstash" || !config.cache.upstashUrl || !config.cache.upstashToken) return memory;
  const redis = new Redis({ url: config.cache.upstashUrl, token: config.cache.upstashToken, automaticDeserialization: false });
  return new LayeredCache(memory, new UpstashCache(redis, getLogger().child({ component: "cache" })));
}

/**
 * Resolve the OpenAI-compat backend to use. Pure: takes config + an
 * ollama-reachability flag and returns the adapter config, or null when
 * no backend is available.
 */
export function selectLlmBackend(
  config: AppConfig,
  ollamaReachable: boolean,
): { backend: "gemini" | "ollama"; adapter: AiSdkLlmConfig } | null {
  const llm = config.llm;
  if (llm.mode !== "live") return null;

  const hasGeminiKey = Boolean(llm.apiKey);
  const preferOllama = llm.preferred === "ollama";

  // Branch 1: Gemini key set AND user did not explicitly ask for Ollama.
  if (hasGeminiKey && !preferOllama) {
    return {
      backend: "gemini",
      adapter: {
        provider: "gemini",
        model: llm.model,
        baseUrl: llm.baseUrlOverride ?? GEMINI_OPENAI_BASE_URL,
        apiKey: llm.apiKey!,
        temperature: llm.temperature,
        timeoutMs: llm.timeoutMs,
        maxRetries: llm.maxRetries,
        cacheTtlSeconds: llm.cacheTtlSeconds,
      },
    };
  }

  // Branch 2: Ollama is reachable at its OpenAI-compat endpoint.
  if (ollamaReachable) {
    return {
      backend: "ollama",
      adapter: {
        provider: "ollama",
        model: llm.model,
        baseUrl: llm.baseUrlOverride ?? `${llm.ollamaBaseUrl}${OLLAMA_OPENAI_SUFFIX}`,
        // Ollama ignores the key but AI SDK requires a non-empty string.
        apiKey: "ollama",
        temperature: llm.temperature,
        timeoutMs: llm.timeoutMs,
        maxRetries: llm.maxRetries,
        cacheTtlSeconds: llm.cacheTtlSeconds,
      },
    };
  }

  return null;
}

export function buildLlmPort(
  config: AppConfig,
  cache: CachePort,
  options: { ollamaReachable?: boolean } = {},
): LlmPort {
  const selected = selectLlmBackend(config, options.ollamaReachable ?? false);
  if (!selected) {
    const reason = config.llm.mode !== "live"
      ? config.llm.mockReason === "forced"
        ? "REKINDLE_FORCE_MOCK is on"
        : "GEMINI_API_KEY is missing and LLM_PROVIDER is not set to a usable backend"
      : config.llm.preferred === "ollama"
        ? "LLM_PROVIDER=ollama requested but the local endpoint did not answer"
        : "GEMINI_API_KEY is missing and local Ollama is not reachable";
    throw new LlmNotConfiguredError(reason);
  }
  return new AiSdkLlm(selected.adapter, cache, { keyPrefix: config.cache.keyPrefix });
}

export function buildTtsPort(config: AppConfig, cache: CachePort): TtsPort {
  // TTS rides on the Gemini key when present; without it we return a no-op
  // port whose /api/tts returns 503 so the client falls back to the browser's
  // Web Speech API. The TTS endpoint is Gemini's native `:generateContent`
  // and not the OpenAI-compat one, so it keeps its own tiny adapter.
  const key = config.llm.apiKey?.trim();
  if (!key || key.length < 8) return new MockTts();
  return new GeminiTts(
    {
      apiKey: key,
      model: GEMINI_TTS_MODEL,
      timeoutMs: config.llm.timeoutMs,
      maxRetries: config.llm.maxRetries,
      cacheTtlSeconds: config.llm.cacheTtlSeconds,
    },
    cache,
    { keyPrefix: config.cache.keyPrefix },
  );
}

export function buildAgentDeps(
  config: AppConfig,
  cache: CachePort = buildCache(config),
  options: { ollamaReachable?: boolean } = {},
): AgentDeps {
  const testing = config.env === "test";
  const taste: TastePort =
    config.qloo.mode === "live"
      ? new QlooHttp(config.qloo, cache, { keyPrefix: config.cache.keyPrefix })
      : new MockQloo({ defaultTake: config.qloo.defaultTake, latencyMs: testing ? 0 : MOCK_LATENCY_MS.qloo });
  const llm = buildLlmPort(config, cache, options);
  const tts = buildTtsPort(config, cache);
  return {
    taste,
    llm,
    cache,
    tts,
    config,
    now: () => new Date(),
    newId: (prefix) => `${prefix}_${nanoid(10)}`,
  };
}

/**
 * Probe Ollama's OpenAI-compat `/v1/models` with a 1500ms timeout. Returns
 * false on any failure. Callers should treat false as "Ollama unavailable",
 * never as a hard error: the fall-through chain decides what happens next.
 */
export async function probeOllama(baseUrl: string, timeoutMs = OLLAMA_PROBE_TIMEOUT_MS): Promise<boolean> {
  try {
    const controller = AbortSignal.timeout(timeoutMs);
    const res = await fetch(`${baseUrl}${OLLAMA_OPENAI_SUFFIX}/models`, { signal: controller });
    return res.ok;
  } catch {
    return false;
  }
}

let deps: AgentDeps | undefined;
let depsPromise: Promise<AgentDeps> | undefined;

/**
 * Sync accessor. Only works when Gemini is keyed (branch 1); for branch 2
 * (Ollama) use the async variant so the reachability probe can run.
 */
export function getAgentDeps(): AgentDeps {
  if (!deps) {
    const config = getConfig();
    deps = buildAgentDeps(config);
    getLogger().info(
      { qloo: config.qloo.mode, llm: config.llm.mode, llmProvider: deps.llm.provider, cache: deps.cache.driver },
      "agent dependencies ready",
    );
  }
  return deps;
}

/**
 * Async composition: probes Ollama when needed, then builds deps. Memoized
 * per serverless instance.
 */
export async function getAgentDepsAsync(
  { config: configOverride }: { config?: AppConfig } = {},
): Promise<AgentDeps> {
  if (deps) return deps;
  if (depsPromise) return depsPromise;
  depsPromise = (async () => {
    const config = configOverride ?? getConfig();
    // Only probe Ollama when we might actually need it: either the user asked
    // for it, or Gemini has no key.
    const needsOllama = config.llm.mode === "live" && (config.llm.preferred === "ollama" || !config.llm.apiKey);
    const ollamaReachable = needsOllama ? await probeOllama(config.llm.ollamaBaseUrl) : false;
    deps = buildAgentDeps(config, undefined, { ollamaReachable });
    getLogger().info(
      { qloo: config.qloo.mode, llm: config.llm.mode, llmProvider: deps.llm.provider, cache: deps.cache.driver },
      "agent dependencies ready",
    );
    return deps;
  })();
  return depsPromise;
}

/**
 * Non-secret view of the EFFECTIVE deps for `/api/health`. Shape mirrors
 * `publicConfigSummary` so the UI badge keeps working. Note we read the
 * active backend from `d.llm.provider` (set by the adapter) rather than
 * from config, so if composition shifted from Gemini to Ollama the health
 * endpoint reports the truth.
 */
export function effectiveConfigSummary(d: AgentDeps) {
  return {
    qloo: { mode: d.config.qloo.mode, mockReason: d.config.qloo.mockReason, baseUrl: d.config.qloo.baseUrl },
    llm: {
      mode: d.config.llm.mode,
      mockReason: d.config.llm.mockReason,
      provider: d.llm.provider,
      model: d.llm.model,
    },
    cache: { driver: d.cache.driver },
  };
}

/** Test-only: reset the memoized deps so subsequent calls rebuild. */
export function _resetAgentDepsForTests(): void {
  deps = undefined;
  depsPromise = undefined;
}
