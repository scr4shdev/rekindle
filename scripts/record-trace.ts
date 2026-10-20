/**
 * Records a deterministic AgentEvent NDJSON fixture for one of the three
 * built-in personas, so the hosted demo can replay the full six-phase run
 * through /api/session/replay even when Qloo rate-limits or an LLM key goes
 * stale. Runs the real agent against the Mock LLM + Mock Qloo adapters, with
 * a fixed clock and a counting id generator so two runs produce byte-
 * identical files.
 *
 * Invocation (vitest is the TS loader; the recorder is one `it()` test):
 *   PERSONA=maria   npx vitest run --config scripts/vitest.record-trace.config.mts
 *   PERSONA=all     npx vitest run --config scripts/vitest.record-trace.config.mts
 *
 * `PERSONA=all` records every built-in persona. Default: maria.
 * `scripts/record-trace.ts` is not part of `npm run check`.
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";

import pino from "pino";
import { it } from "vitest";

import { runSession } from "@/lib/agent";
import { MemoryCache } from "@/lib/adapters/cache";
import { MockLlm } from "@/lib/adapters/llm/mock";
import { MockQloo } from "@/lib/adapters/qloo/mock";
import { loadConfig } from "@/lib/config";
import type { AgentEvent, SessionRequest as SessionRequestType } from "@/lib/domain/types";
import { SessionRequest } from "@/lib/domain/types";
import { PERSONAS, getPersona } from "@/lib/personas";
import type { AgentDeps } from "@/lib/ports";

import * as composeSessionPrompt from "@/lib/prompts/compose-session";
import * as critiqueItemsPrompt from "@/lib/prompts/critique-items";
import * as culturalCheckPrompt from "@/lib/prompts/cultural-check";
import * as matchEntityPrompt from "@/lib/prompts/match-entity";
import * as parseAnchorsPrompt from "@/lib/prompts/parse-anchors";
import * as proposeCandidatesPrompt from "@/lib/prompts/propose-candidates";
import * as replanSessionPrompt from "@/lib/prompts/replan-session";

/** Fixed start-of-run clock. Anchoring the clock keeps every recorded `t` reproducible. */
const FIXED_START = new Date("2026-10-18T19:00:00.000Z");
/** How much to advance the injected clock per `now()` call. Chosen so phase durations are visible. */
const CLOCK_STEP_MS = 20;
/** Output directory for the committed fixtures. Resolves against the worktree root. */
const FIXTURES_DIR = path.join(process.cwd(), "tests", "fixtures");

/** Static prompt version map so the fixture meta reflects the exact prompt set. */
const PROMPT_VERSIONS: Record<string, string> = {
  [parseAnchorsPrompt.ID]: parseAnchorsPrompt.VERSION,
  [proposeCandidatesPrompt.ID]: proposeCandidatesPrompt.VERSION,
  [matchEntityPrompt.ID]: matchEntityPrompt.VERSION,
  [culturalCheckPrompt.ID]: culturalCheckPrompt.VERSION,
  [critiqueItemsPrompt.ID]: critiqueItemsPrompt.VERSION,
  [composeSessionPrompt.ID]: composeSessionPrompt.VERSION,
  [replanSessionPrompt.ID]: replanSessionPrompt.VERSION,
};

function pickSlugs(): Array<(typeof PERSONAS)[number]["slug"]> {
  const raw = (process.env.PERSONA ?? "maria").toLowerCase();
  if (raw === "all") return PERSONAS.map((p) => p.slug);
  const persona = getPersona(raw);
  if (!persona) {
    throw new Error(`Unknown PERSONA '${raw}'. Expected one of: all, ${PERSONAS.map((p) => p.slug).join(", ")}`);
  }
  return [persona.slug];
}

/** Build mock-mode deps with an injected monotonic clock and a counting id generator. */
function buildDeterministicDeps(): AgentDeps {
  const config = loadConfig({ REKINDLE_FORCE_MOCK: "true", LOG_LEVEL: "silent" });
  const cache = new MemoryCache();
  let tick = 0;
  let idN = 0;
  return {
    // latencyMs: 0 keeps qloo_call.durationMs deterministic (no wall-clock).
    taste: new MockQloo({ defaultTake: config.qloo.defaultTake, latencyMs: 0 }),
    llm: new MockLlm({ cache, cacheTtlSeconds: config.llm.cacheTtlSeconds, latencyMs: 0 }),
    cache,
    config,
    now: () => new Date(FIXED_START.getTime() + (tick++) * CLOCK_STEP_MS),
    newId: (prefix) => `${prefix}_${++idN}`,
  };
}

async function recordOne(slug: (typeof PERSONAS)[number]["slug"]): Promise<void> {
  const persona = getPersona(slug);
  if (!persona) throw new Error(`Persona not found: ${slug}`);
  const deps = buildDeterministicDeps();
  const request: SessionRequestType = SessionRequest.parse({ person: persona.input, mode: "grounded" });

  const abort = new AbortController();
  const logger = pino({ level: "silent" });
  const events: AgentEvent[] = [];
  for await (const event of runSession(deps, request, { traceId: `fixture-${slug}`, logger, signal: abort.signal })) {
    events.push(event);
  }

  const ndjson = events.map((e) => `${JSON.stringify(e)}\n`).join("");
  const ndjsonPath = path.join(FIXTURES_DIR, `trace-${slug}.ndjson`);
  writeFileSync(ndjsonPath, ndjson);

  const totalDurationMs = events.length ? events[events.length - 1].t : 0;
  const summary = {
    promptVersions: PROMPT_VERSIONS,
    qloo: { mode: deps.config.qloo.mode },
    llm: { provider: deps.config.llm.provider, model: deps.config.llm.model },
    recordedAt: FIXED_START.toISOString(),
    totalDurationMs,
    eventCount: events.length,
    // Hash of the NDJSON for the determinism unit test to spot regressions.
    sha256: createHash("sha256").update(ndjson).digest("hex"),
  };
  const metaPath = path.join(FIXTURES_DIR, `trace-${slug}.meta.json`);
  writeFileSync(metaPath, `${JSON.stringify(summary, null, 2)}\n`);

  process.stdout.write(`recorded ${events.length} events for ${slug} -> ${ndjsonPath}\n`);
}

it("records trace fixtures for the selected personas", { timeout: 60_000 }, async () => {
  for (const slug of pickSlugs()) {
    await recordOne(slug);
  }
});
