/**
 * Composition root: the single place that reads config and wires adapters
 * into AgentDeps. One instance per serverless instance (warm invocations
 * share the in-memory cache). Server-only.
 */
import { Redis } from "@upstash/redis";
import { nanoid } from "nanoid";

import { LayeredCache, MemoryCache, UpstashCache } from "@/lib/adapters/cache";
import type { LiveLlmConfig } from "@/lib/adapters/llm/ai-sdk";
import { AiSdkLlm } from "@/lib/adapters/llm/ai-sdk";
import { MockLlm } from "@/lib/adapters/llm/mock";
import type { Fetcher, LiveOllamaConfig } from "@/lib/adapters/llm/ollama";
import { isOllamaReachable, OllamaLlm } from "@/lib/adapters/llm/ollama";
import { QlooHttp } from "@/lib/adapters/qloo/http";
import { MockQloo } from "@/lib/adapters/qloo/mock";
import { GEMINI_TTS_MODEL, GeminiTts } from "@/lib/adapters/tts/gemini";
import { MockTts } from "@/lib/adapters/tts/mock";
import type { AppConfig } from "@/lib/config";
import { getConfig, OLLAMA_DEFAULT_BASE_URL, OLLAMA_DEFAULT_MODEL } from "@/lib/config";
import { getLogger } from "@/lib/logger";
import type { AgentDeps, CachePort, LlmPort, TastePort, TtsPort } from "@/lib/ports";

/**
 * Below this agent deadline we warn when Ollama is the active LLM: local
 * inference typically takes 90-150s per full six-phase run on consumer GPUs,
 * so a 60s serverless budget will time out mid-run. The config.ts default
 * (55_000) is tuned for hosted providers and cannot be edited (frozen).
 * Operators should set AGENT_DEADLINE_MS=300000 for local Ollama demos.
 */
export const OLLAMA_MIN_DEADLINE_MS = 180_000;
/** How long Ollama should keep the model loaded on the GPU after a prewarm. */
const OLLAMA_KEEP_ALIVE = "30m";
/** Prewarm timeout; a cold model-load on CPU can take 10-20s. */
const OLLAMA_PREWARM_TIMEOUT_MS = 30_000;

/**
 * Simulated latency of the mock adapters outside tests, so the demo trace
 * streams at a readable pace instead of all at once.
 */
export const MOCK_LATENCY_MS = { llm: 250, qloo: 60 } as const;

export function buildCache(config: AppConfig): CachePort {
  const memory = new MemoryCache();
  if (config.cache.driver !== "upstash" || !config.cache.upstashUrl || !config.cache.upstashToken) return memory;
  const redis = new Redis({ url: config.cache.upstashUrl, token: config.cache.upstashToken, automaticDeserialization: false });
  return new LayeredCache(memory, new UpstashCache(redis, getLogger().child({ component: "cache" })));
}

export function buildLlmPort(config: AppConfig, cache: CachePort, testing: boolean): LlmPort {
  const keyPrefix = config.cache.keyPrefix;
  if (config.llm.mode === "live" && config.llm.provider === "ollama") {
    return new OllamaLlm(
      {
        ...config.llm,
        provider: "ollama",
        baseUrl: config.llm.ollamaBaseUrl ?? OLLAMA_DEFAULT_BASE_URL,
      } as LiveOllamaConfig,
      cache,
      { keyPrefix },
    );
  }
  if (config.llm.mode === "live" && config.llm.provider !== "mock") {
    return new AiSdkLlm(config.llm as LiveLlmConfig, cache, { keyPrefix });
  }
  return new MockLlm({
    cache,
    cacheTtlSeconds: config.llm.cacheTtlSeconds,
    latencyMs: testing ? 0 : MOCK_LATENCY_MS.llm,
  });
}

export function buildTtsPort(config: AppConfig, cache: CachePort): TtsPort {
  // TTS rides on the Gemini key when present; mock mode (and REKINDLE_FORCE_MOCK)
  // yields a no-op port whose /api/tts returns 503 so the client falls back to
  // the browser's own Web Speech API.
  //
  // Why read process.env directly here rather than through config.ts: adding a
  // dedicated TTS key field would mean editing the frozen config contract,
  // and TTS is a demo-side fallback that must work regardless of
  // LLM_PROVIDER (the local demo pins LLM_PROVIDER=ollama, so
  // config.llm.apiKey is undefined even when the Gemini key is set). We skip
  // the port in forced-mock mode so tests and E2E stay deterministic.
  if (config.llm.mode === "mock" && config.llm.mockReason === "forced") return new MockTts();
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
  const llm = buildLlmPort(config, cache, testing);
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

/** Memoized dependencies for this serverless instance. Synchronous path: skips the Ollama reachability probe. */
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
 * Async variant: resolves the effective LLM port by probing the local Ollama
 * endpoint.
 *
 *  1. `LLM_PROVIDER=ollama` (explicit): probe; keep Ollama if reachable,
 *     downgrade to mock with `mockReason: "unreachable"` otherwise.
 *  2. No provider configured and no hosted key present (config resolves to
 *     mock with `mockReason: "missing_key"`): probe; auto-upgrade to Ollama
 *     if reachable, keep mock otherwise. This makes the local Tailscale demo
 *     pick Ollama with no env change while Vercel-without-Ollama stays mock.
 *  3. REKINDLE_FORCE_MOCK (`mockReason: "forced"`) or an explicit hosted
 *     provider: no probe, respect the config.
 *
 * When the effective LLM is Ollama, best-effort pre-warm the model with a
 * 30-minute keep-alive so the first agent run doesn't pay the GPU cold-start,
 * and warn loudly if the agent deadline is too short for local inference.
 *
 * Result is cached in-process.
 */
export async function getAgentDepsAsync(
  {
    probe = isOllamaReachable,
    config: configOverride,
    prewarm = defaultPrewarm,
  }: {
    probe?: typeof isOllamaReachable;
    config?: AppConfig;
    prewarm?: (baseUrl: string, model: string) => Promise<void>;
  } = {},
): Promise<AgentDeps> {
  if (deps) return deps;
  if (depsPromise) return depsPromise;
  depsPromise = (async () => {
    const config = configOverride ?? getConfig();
    let effective = config;
    const baseUrl = config.llm.ollamaBaseUrl ?? OLLAMA_DEFAULT_BASE_URL;
    const ollamaModel = config.llm.ollamaModel ?? OLLAMA_DEFAULT_MODEL;

    if (config.llm.mode === "live" && config.llm.provider === "ollama") {
      // Explicit Ollama request: probe, and downgrade to mock if the endpoint is dead.
      const reachable = await probe(baseUrl);
      if (!reachable) {
        effective = {
          ...config,
          llm: {
            ...config.llm,
            mode: "mock",
            mockReason: "unreachable",
            provider: "mock",
            model: "mock-llm",
            apiKey: undefined,
            ollamaBaseUrl: baseUrl,
          },
        };
        getLogger().warn({ baseUrl }, "ollama not reachable; falling back to mock LLM");
      }
    } else if (config.llm.mode === "mock" && config.llm.mockReason === "missing_key") {
      // No provider explicitly requested and no hosted key: try Ollama before
      // settling for the mock LLM. REKINDLE_FORCE_MOCK (mockReason: "forced")
      // and the "configured" case (requested === "mock") never get here, so
      // tests and E2E keep their mock LLM.
      const reachable = await probe(baseUrl);
      if (reachable) {
        effective = {
          ...config,
          llm: {
            ...config.llm,
            mode: "live",
            mockReason: undefined,
            provider: "ollama",
            model: ollamaModel,
            apiKey: undefined,
            ollamaBaseUrl: baseUrl,
            ollamaModel,
          },
        };
        getLogger().info({ baseUrl, model: ollamaModel }, "no hosted LLM key; auto-wiring local Ollama");
      }
    }

    deps = buildAgentDeps(effective);
    getLogger().info(
      { qloo: effective.qloo.mode, llm: effective.llm.mode, llmProvider: effective.llm.provider, cache: deps.cache.driver },
      "agent dependencies ready",
    );

    if (effective.llm.mode === "live" && effective.llm.provider === "ollama") {
      // Loud warning when the deadline is below what local inference needs.
      // config.ts is frozen; operators adjust via the AGENT_DEADLINE_MS env.
      if (effective.agent.deadlineMs < OLLAMA_MIN_DEADLINE_MS) {
        getLogger().warn(
          {
            deadlineMs: effective.agent.deadlineMs,
            minDeadlineMs: OLLAMA_MIN_DEADLINE_MS,
            suggested: "AGENT_DEADLINE_MS=300000",
          },
          "ollama LLM is active but AGENT_DEADLINE_MS is too short for local inference; set AGENT_DEADLINE_MS=300000",
        );
      }
      // Best-effort GPU warmup: never block composition, never throw.
      void prewarm(baseUrl, ollamaModel).catch((cause) => {
        getLogger().warn({ cause: (cause as Error)?.message }, "ollama prewarm failed");
      });
    }

    return deps;
  })();
  return depsPromise;
}

/**
 * Fire-and-forget call that loads the Ollama model on the GPU and asks the
 * server to keep it resident. Uses /api/generate with an empty prompt so no
 * tokens are generated; we only care about the model-load side effect.
 */
async function defaultPrewarm(baseUrl: string, model: string, fetcher: Fetcher = (u, i) => fetch(u, i)): Promise<void> {
  const url = `${baseUrl.replace(/\/+$/, "")}/api/generate`;
  const signal = AbortSignal.timeout(OLLAMA_PREWARM_TIMEOUT_MS);
  const res = await fetcher(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, prompt: "", stream: false, keep_alive: OLLAMA_KEEP_ALIVE }),
    signal,
  });
  if (!res.ok) {
    throw new Error(`ollama prewarm HTTP ${res.status}`);
  }
  getLogger().info({ model, keepAlive: OLLAMA_KEEP_ALIVE }, "ollama prewarm complete");
}

/**
 * Non-secret view of the EFFECTIVE deps for `/api/health`: reports what the
 * agent will actually use (after the Ollama reachability probe), not what the
 * static config file resolved to. Shape mirrors `publicConfigSummary` so the UI
 * badge keeps working.
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
