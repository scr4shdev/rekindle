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
import type { LiveOllamaConfig } from "@/lib/adapters/llm/ollama";
import { isOllamaReachable, OllamaLlm } from "@/lib/adapters/llm/ollama";
import { QlooHttp } from "@/lib/adapters/qloo/http";
import { MockQloo } from "@/lib/adapters/qloo/mock";
import type { AppConfig } from "@/lib/config";
import { getConfig, OLLAMA_DEFAULT_BASE_URL } from "@/lib/config";
import { getLogger } from "@/lib/logger";
import type { AgentDeps, CachePort, LlmPort, TastePort } from "@/lib/ports";

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

export function buildAgentDeps(config: AppConfig, cache: CachePort = buildCache(config)): AgentDeps {
  const testing = config.env === "test";
  const taste: TastePort =
    config.qloo.mode === "live"
      ? new QlooHttp(config.qloo, cache, { keyPrefix: config.cache.keyPrefix })
      : new MockQloo({ defaultTake: config.qloo.defaultTake, latencyMs: testing ? 0 : MOCK_LATENCY_MS.qloo });
  const llm = buildLlmPort(config, cache, testing);
  return {
    taste,
    llm,
    cache,
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
 * Async variant: probes the local Ollama endpoint when it was explicitly
 * selected (LLM_PROVIDER=ollama) and downgrades to the Mock LLM if the endpoint
 * is not reachable. There is no silent auto-upgrade from mock to Ollama when a
 * hosted key is missing: Ollama is opt-in, because its generation latency does
 * not fit the default AGENT_DEADLINE_MS and would surprise hosted deploys.
 * Result is cached in-process.
 */
export async function getAgentDepsAsync(
  {
    probe = isOllamaReachable,
    config: configOverride,
  }: { probe?: typeof isOllamaReachable; config?: AppConfig } = {},
): Promise<AgentDeps> {
  if (deps) return deps;
  if (depsPromise) return depsPromise;
  depsPromise = (async () => {
    const config = configOverride ?? getConfig();
    let effective = config;
    const baseUrl = config.llm.ollamaBaseUrl ?? OLLAMA_DEFAULT_BASE_URL;

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
    }

    deps = buildAgentDeps(effective);
    getLogger().info(
      { qloo: effective.qloo.mode, llm: effective.llm.mode, llmProvider: effective.llm.provider, cache: deps.cache.driver },
      "agent dependencies ready",
    );
    return deps;
  })();
  return depsPromise;
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
