/**
 * The committed trace fixtures are recorded from real Gemini runs now (see
 * scripts/record-trace.ts). Gemini is not byte-deterministic even at
 * temperature 0, so the earlier "two runs produce identical NDJSON" assertion
 * no longer holds. The fixture file IS the demo artifact: the hosted replay
 * route streams it exactly as committed.
 *
 * This test is a sanity rail: for each persona, the fixture file exists,
 * every line is a valid AgentEvent, the first event is a `phase: parse
 * started`, the last is a `done`, and the stream carries at least a plan.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { AgentEvent } from "@/lib/domain/types";
import { PERSONAS } from "@/lib/personas";

const FIXTURES_DIR = path.join(process.cwd(), "tests", "fixtures");
const MIN_EVENTS = 10;

describe("committed persona fixtures", () => {
  it.each(PERSONAS.map((p) => p.slug))("trace-%s.ndjson parses, has a plan, and ends with done", (slug) => {
    const raw = readFileSync(path.join(FIXTURES_DIR, `trace-${slug}.ndjson`), "utf-8");
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(MIN_EVENTS);
    const events = lines.map((line) => AgentEvent.parse(JSON.parse(line)));
    expect(events[0].type).toBe("phase");
    expect(events.at(-1)!.type).toBe("done");
    const planEvents = events.filter((e) => e.type === "plan");
    expect(planEvents.length).toBe(1);
  });
});
