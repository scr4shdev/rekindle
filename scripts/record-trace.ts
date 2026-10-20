/**
 * Records an AgentEvent NDJSON fixture for one of the three built-in personas
 * from a real Gemini + Qloo run, so the hosted demo can replay the full
 * six-phase run through /api/session/replay without burning quota on every
 * judge click.
 *
 * The recorder calls the live `/api/session` HTTP endpoint on the configured
 * server, captures the raw NDJSON byte stream, and validates each line.
 * This exercises the same path a real deploy would serve.
 *
 * Gemini is not byte-deterministic even at temperature 0, so a re-record
 * will drift. The committed fixture IS the demo artifact.
 *
 * Invocation (vitest is the TS loader; the recorder is one `it()` test):
 *   REKINDLE_RECORD_BASE=http://100.97.114.27:3300 PERSONA=maria \
 *     npx vitest run --config scripts/vitest.record-trace.config.mts
 *   REKINDLE_RECORD_BASE=http://localhost:3000 PERSONA=all \
 *     npx vitest run --config scripts/vitest.record-trace.config.mts
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";

import { it } from "vitest";

import { AgentEvent } from "@/lib/domain/types";
import { PERSONAS, getPersona } from "@/lib/personas";

import * as composeSessionPrompt from "@/lib/prompts/compose-session";
import * as critiqueItemsPrompt from "@/lib/prompts/critique-items";
import * as culturalCheckPrompt from "@/lib/prompts/cultural-check";
import * as matchEntityPrompt from "@/lib/prompts/match-entity";
import * as parseAnchorsPrompt from "@/lib/prompts/parse-anchors";
import * as proposeCandidatesPrompt from "@/lib/prompts/propose-candidates";
import * as replanSessionPrompt from "@/lib/prompts/replan-session";

const FIXTURES_DIR = path.join(process.cwd(), "tests", "fixtures");
const BASE_URL = process.env.REKINDLE_RECORD_BASE ?? "http://100.97.114.27:3300";

/** Pace between personas to respect Gemini daily quotas. */
const PACE_MS = 10_000;
/** Retry budget on 429 or sparse recordings. */
const RETRIES = 3;
/** Backoff on 429. */
const BACKOFF_MS = 60_000;
/** Minimum sane event count for a plan recording. Below this, we treat it as a failed run and retry. */
const MIN_EVENTS = 20;

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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function postSessionAndCollect(slug: (typeof PERSONAS)[number]["slug"]): Promise<{
  events: AgentEvent[];
  rawLines: string[];
}> {
  const persona = getPersona(slug);
  if (!persona) throw new Error(`Persona not found: ${slug}`);
  const url = `${BASE_URL.replace(/\/+$/, "")}/api/session`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ person: persona.input, mode: "grounded" }),
  });
  if (!res.ok) {
    throw new Error(`POST ${url} returned ${res.status} ${res.statusText}`);
  }
  if (!res.body) throw new Error("Response had no body");
  const decoder = new TextDecoder();
  const reader = res.body.getReader();
  const rawLines: string[] = [];
  const events: AgentEvent[] = [];
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line.length > 0) {
        rawLines.push(line);
        events.push(AgentEvent.parse(JSON.parse(line)));
      }
      newlineIndex = buffer.indexOf("\n");
    }
  }
  if (buffer.trim().length > 0) {
    rawLines.push(buffer.trim());
    events.push(AgentEvent.parse(JSON.parse(buffer.trim())));
  }
  return { events, rawLines };
}

async function recordOne(slug: (typeof PERSONAS)[number]["slug"]): Promise<void> {
  let lastError: unknown;
  let events: AgentEvent[] = [];
  let rawLines: string[] = [];
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const startedAt = Date.now();
      const result = await postSessionAndCollect(slug);
      events = result.events;
      rawLines = result.rawLines;
      const hasPlan = events.some((e) => e.type === "plan");
      const rateLimited = events.some((e) => e.type === "error" && /rate|quota|429/i.test(e.message));
      if (!hasPlan || events.length < MIN_EVENTS) {
        const kind = rateLimited ? "rate_limited" : "sparse";
        process.stdout.write(`attempt ${attempt}/${RETRIES} ${kind} for ${slug}: ${events.length} events, hasPlan=${hasPlan}\n`);
        if (attempt < RETRIES) {
          const wait = rateLimited ? BACKOFF_MS : 10_000;
          process.stdout.write(`backing off ${wait}ms before retry\n`);
          await sleep(wait);
          continue;
        }
        throw new Error(`Recording for ${slug} did not produce a plan after ${RETRIES} attempts (last events: ${events.length}, ${kind}).`);
      }
      process.stdout.write(`recorded ${events.length} events for ${slug} in ${Date.now() - startedAt}ms\n`);
      lastError = undefined;
      break;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      process.stdout.write(`attempt ${attempt}/${RETRIES} failed for ${slug}: ${message}\n`);
      if (attempt < RETRIES && /429|rate|quota/i.test(message)) {
        process.stdout.write(`backing off ${BACKOFF_MS}ms before retry\n`);
        await sleep(BACKOFF_MS);
      } else if (attempt < RETRIES) {
        await sleep(5_000);
      }
    }
  }
  if (lastError) throw lastError;

  const ndjson = rawLines.map((l) => `${l}\n`).join("");
  const ndjsonPath = path.join(FIXTURES_DIR, `trace-${slug}.ndjson`);
  writeFileSync(ndjsonPath, ndjson);

  const totalDurationMs = events.length ? events[events.length - 1].t : 0;
  const planEvent = events.find((e) => e.type === "plan");
  const planMeta = planEvent && planEvent.type === "plan" ? planEvent.plan.meta : undefined;
  const summary = {
    promptVersions: PROMPT_VERSIONS,
    qloo: { mode: planMeta?.qlooMode ?? "live" },
    llm: { provider: planMeta?.llmProvider ?? "gemini", model: planMeta?.llmModel ?? "gemini-3.1-flash-lite" },
    recordedAt: new Date().toISOString(),
    totalDurationMs,
    eventCount: events.length,
    sha256: createHash("sha256").update(ndjson).digest("hex"),
    sourceUrl: `${BASE_URL}/api/session`,
  };
  const metaPath = path.join(FIXTURES_DIR, `trace-${slug}.meta.json`);
  writeFileSync(metaPath, `${JSON.stringify(summary, null, 2)}\n`);

  process.stdout.write(`wrote ${ndjsonPath} and ${metaPath}\n`);
}

it("records trace fixtures for the selected personas from the live /api/session", { timeout: 600_000 }, async () => {
  const slugs = pickSlugs();
  for (let i = 0; i < slugs.length; i++) {
    if (i > 0) {
      process.stdout.write(`pacing ${PACE_MS}ms before next persona\n`);
      await sleep(PACE_MS);
    }
    await recordOne(slugs[i]);
  }
});
