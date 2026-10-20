/**
 * Composition root: the single place that reads config and wires adapters
 * into AgentDeps. One instance per serverless instance (warm invocations
 * share the in-memory cache). Server-only.
 *
 * Policy: Gemini-only. If GEMINI_API_KEY is not present the agent cannot
 * run — we throw at composition time rather than silently falling back to
 * a mock. The old MockLlm and OllamaLlm have been removed; see
 * TODO.md "Contract change requests" for the (still frozen) config.ts
 * leftovers that reference those providers.
 */
import { Redis } from "@upstash/redis";
import { nanoid } from "nanoid";

import { LayeredCache, MemoryCache, UpstashCache } from "@/lib/adapters/cache";
import type { LiveLlmConfig } from "@/lib/adapters/llm/ai-sdk";
import { AiSdkLlm } from "@/lib/adapters/llm/ai-sdk";
import { QlooHttp } from "@/lib/adapters/qloo/http";
import { MockQloo } from "@/lib/adapters/qloo/mock";
import { GEMINI_TTS_MODEL, GeminiTts } from "@/lib/adapters/tts/gemini";
import { MockTts } from "@/lib/adapters/tts/mock";
import type { AppConfig } from "@/lib/config";
import { getConfig } from "@/lib/config";
import { getLogger } from "@/lib/logger";
import type { AgentDeps, CachePort, LlmPort, TastePort, TtsPort } from "@/lib/ports";

/**
 * Simulated latency of the Qloo mock outside tests, so the demo trace streams
 * at a readable pace instead of all at once. (LLM mocks are gone.)
 */
export const MOCK_LATENCY_MS = { qloo: 60 } as const;

export class LlmNotConfiguredError extends Error {
  constructor() {
    super("GEMINI_API_KEY is required. No fallback adapter is available.");
    this.name = "LlmNotConfiguredError";
  }
}

export function buildCache(config: AppConfig): CachePort {
  const memory = new MemoryCache();
  if (config.cache.driver !== "upstash" || !config.cache.upstashUrl || !config.cache.upstashToken) return memory;
  const redis = new Redis({ url: config.cache.upstashUrl, token: config.cache.upstashToken, automaticDeserialization: false });
  return new LayeredCache(memory, new UpstashCache(redis, getLogger().child({ component: "cache" })));
}

export function buildLlmPort(config: AppConfig, cache: CachePort): LlmPort {
  if (config.llm.mode !== "live" || config.llm.provider !== "gemini") {
    throw new LlmNotConfiguredError();
  }
  return new AiSdkLlm(config.llm as LiveLlmConfig, cache, { keyPrefix: config.cache.keyPrefix });
}

export function buildTtsPort(config: AppConfig, cache: CachePort): TtsPort {
  // TTS rides on the Gemini key when present; without it we return a no-op
  // port whose /api/tts returns 503 so the client falls back to the browser's
  // Web Speech API. Reading process.env directly here because the frozen
  // config contract has no dedicated TTS key field.
  const key = process.env.GEMINI_API_KEY?.trim();
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

export function buildAgentDeps(config: AppConfig, cache: CachePort = buildCache(config)): AgentDeps {
  const testing = config.env === "test";
  const taste: TastePort =
    config.qloo.mode === "live"
      ? new QlooHttp(config.qloo, cache, { keyPrefix: config.cache.keyPrefix })
      : new MockQloo({ defaultTake: config.qloo.defaultTake, latencyMs: testing ? 0 : MOCK_LATENCY_MS.qloo });
  const llm = buildLlmPort(config, cache);
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

let deps: AgentDeps | undefined;
let depsPromise: Promise<AgentDeps> | undefined;

/** Memoized dependencies for this serverless instance. */
export function getAgentDeps(): AgentDeps {
  if (!deps) {
    const config = getConfig();
    deps = buildAgentDeps(config);
    getLogger().info(
      { qloo: config.qloo.mode, llm: config.llm.mode, llmProvider: config.llm.provider, cache: deps.cache.driver },
      "agent dependencies ready",
    );
  }
  return deps;
}

/**
 * Async variant kept for API-shape compatibility with earlier Ollama-probe
 * logic. There is no probe now: we just resolve to the synchronous build.
 */
export async function getAgentDepsAsync(
  { config: configOverride }: { config?: AppConfig } = {},
): Promise<AgentDeps> {
  if (deps) return deps;
  if (depsPromise) return depsPromise;
  depsPromise = Promise.resolve().then(() => {
    const config = configOverride ?? getConfig();
    deps = buildAgentDeps(config);
    getLogger().info(
      { qloo: config.qloo.mode, llm: config.llm.mode, llmProvider: config.llm.provider, cache: deps.cache.driver },
      "agent dependencies ready",
    );
    return deps;
  });
  return depsPromise;
}

/**
 * Non-secret view of the EFFECTIVE deps for `/api/health`. Shape mirrors
 * `publicConfigSummary` so the UI badge keeps working.
 */
export function effectiveConfigSummary(d: AgentDeps) {
  return {
    qloo: { mode: d.config.qloo.mode, mockReason: d.config.qloo.mockReason, baseUrl: d.config.qloo.baseUrl },
    llm: {
      mode: d.config.llm.mode,
      mockReason: d.config.llm.mockReason,
      provider: d.config.llm.provider,
      model: d.config.llm.model,
    },
    cache: { driver: d.cache.driver },
  };
}

/** Test-only: reset the memoized deps so subsequent calls rebuild. */
export function _resetAgentDepsForTests(): void {
  deps = undefined;
  depsPromise = undefined;
}
