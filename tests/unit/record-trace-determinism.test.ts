/**
 * The recorder must be byte-deterministic: temperature 0, injected `now` /
 * `newId`, latencyMs zeroed on both mocks. If this breaks, the committed
 * fixtures stop being reproducible and the hosted replay drifts from source.
 *
 * This test re-runs the agent twice with the same deterministic deps and
 * hashes the NDJSON output, instead of invoking the recorder script (which
 * writes to disk). The deps-building logic mirrors scripts/record-trace.ts.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import pino from "pino";
import { describe, expect, it } from "vitest";

import { MemoryCache } from "@/lib/adapters/cache";
import { MockLlm } from "@/lib/adapters/llm/mock";
import { MockQloo } from "@/lib/adapters/qloo/mock";
import { runSession } from "@/lib/agent";
import { loadConfig } from "@/lib/config";
import type { AgentEvent } from "@/lib/domain/types";
import { SessionRequest } from "@/lib/domain/types";
import { PERSONAS } from "@/lib/personas";
import type { AgentDeps } from "@/lib/ports";

const FIXED_START = new Date("2026-10-18T19:00:00.000Z");
const CLOCK_STEP_MS = 20;

function freshDeps(): AgentDeps {
  const config = loadConfig({ REKINDLE_FORCE_MOCK: "true", LOG_LEVEL: "silent" });
  const cache = new MemoryCache();
  let tick = 0;
  let idN = 0;
  return {
    taste: new MockQloo({ defaultTake: config.qloo.defaultTake, latencyMs: 0 }),
    llm: new MockLlm({ cache, cacheTtlSeconds: config.llm.cacheTtlSeconds, latencyMs: 0 }),
    cache,
    config,
    now: () => new Date(FIXED_START.getTime() + (tick++) * CLOCK_STEP_MS),
    newId: (prefix) => `${prefix}_${++idN}`,
  };
}

async function record(slug: (typeof PERSONAS)[number]["slug"]): Promise<{ ndjson: string; events: AgentEvent[] }> {
  const persona = PERSONAS.find((p) => p.slug === slug)!;
  const deps = freshDeps();
  const request = SessionRequest.parse({ person: persona.input, mode: "grounded" });
  const abort = new AbortController();
  const logger = pino({ level: "silent" });
  const events: AgentEvent[] = [];
  for await (const event of runSession(deps, request, { traceId: `fixture-${slug}`, logger, signal: abort.signal })) {
    events.push(event);
  }
  return { ndjson: events.map((e) => `${JSON.stringify(e)}\n`).join(""), events };
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

describe("record-trace determinism", () => {
  it.each(PERSONAS.map((p) => p.slug))("two runs for %s produce byte-identical NDJSON", async (slug) => {
    const a = await record(slug);
    const b = await record(slug);
    expect(sha(a.ndjson)).toBe(sha(b.ndjson));
    expect(a.events.length).toBeGreaterThan(0);
  });

  it.each(PERSONAS.map((p) => p.slug))(
    "committed fixture for %s matches a fresh recording (sha256 in the meta file)",
    async (slug) => {
      const fresh = await record(slug);
      const metaPath = path.join(process.cwd(), "tests", "fixtures", `trace-${slug}.meta.json`);
      const meta = JSON.parse(readFileSync(metaPath, "utf-8")) as { sha256: string };
      expect(sha(fresh.ndjson)).toBe(meta.sha256);
    },
  );
});
