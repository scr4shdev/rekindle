import { MemoryCache } from "@/lib/adapters/cache";
import { MockLlm } from "@/lib/adapters/llm/mock";
import { MockQloo } from "@/lib/adapters/qloo/mock";
import { loadConfig } from "@/lib/config";
import type { AgentEvent } from "@/lib/domain/types";
import type { AgentDeps } from "@/lib/ports";

export const FIXED_NOW = new Date("2026-10-18T19:00:00.000Z");

/** Mock-mode dependencies with a fixed clock and a counting id generator. */
export function mockDeps(overrides: Partial<AgentDeps> = {}, env: Record<string, string> = {}): AgentDeps {
  const config = loadConfig({ REKINDLE_FORCE_MOCK: "true", LOG_LEVEL: "silent", ...env });
  const cache = new MemoryCache();
  let n = 0;
  return {
    taste: new MockQloo({ defaultTake: config.qloo.defaultTake }),
    llm: new MockLlm({ cache, cacheTtlSeconds: config.llm.cacheTtlSeconds }),
    cache,
    config,
    now: () => FIXED_NOW,
    newId: (prefix) => `${prefix}_${++n}`,
    ...overrides,
  };
}

export async function collect(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
}
