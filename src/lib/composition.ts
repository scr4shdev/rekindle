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
import { QlooHttp } from "@/lib/adapters/qloo/http";
import { MockQloo } from "@/lib/adapters/qloo/mock";
import type { AppConfig } from "@/lib/config";
import { getConfig } from "@/lib/config";
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

export function buildAgentDeps(config: AppConfig, cache: CachePort = buildCache(config)): AgentDeps {
  const testing = config.env === "test";
  const keyPrefix = config.cache.keyPrefix;
  const taste: TastePort =
    config.qloo.mode === "live"
      ? new QlooHttp(config.qloo, cache, { keyPrefix })
      : new MockQloo({ defaultTake: config.qloo.defaultTake, latencyMs: testing ? 0 : MOCK_LATENCY_MS.qloo });
  const llm: LlmPort =
    config.llm.mode === "live" && config.llm.provider !== "mock"
      ? new AiSdkLlm(config.llm as LiveLlmConfig, cache, { keyPrefix })
      : new MockLlm({ cache, cacheTtlSeconds: config.llm.cacheTtlSeconds, latencyMs: testing ? 0 : MOCK_LATENCY_MS.llm });
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
