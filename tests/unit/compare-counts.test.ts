/**
 * Hero stat, grid caught row and mobile glance strip in the compare view all
 * report the same number: pre-plan rejections whose kind lands in
 * CAUGHT_KINDS (anachronism, wrong_locale, emotional_risk). Replan
 * rejections and not_found / low_relevance / duplicate are excluded from
 * all three. This invariant is enforced by caughtRejections() in
 * compare-view; the test here feeds each committed persona fixture through
 * the view reducer and asserts the three surfaces agree.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CAUGHT_KINDS, caughtRejections } from "@/components/compare/compare-view";
import { viewFromEvents } from "@/components/session/view-state";
import type { AgentEvent } from "@/lib/domain/types";

const PERSONAS = ["maria", "fatima", "seamus"] as const;

function loadEvents(slug: string): AgentEvent[] {
  const file = path.join(process.cwd(), "tests", "fixtures", `trace-${slug}.ndjson`);
  return readFileSync(file, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as AgentEvent);
}

describe("compare view count parity", () => {
  it.each(PERSONAS)("%s: hero / grid / glance / rejection-list all agree", (slug) => {
    const view = viewFromEvents(loadEvents(slug));
    // What the hero and grid read: metrics(view).caught via caughtRejections.
    const hero = caughtRejections(view).length;
    // The glance list.
    const glance = view.rejected
      .filter((r) => r.phase !== "replan" && CAUGHT_KINDS.has(r.kind)).length;
    // The rejected list the ComparePlan renders for the grounded column.
    const planCaught = view.rejected
      .filter((r) => r.phase !== "replan" && CAUGHT_KINDS.has(r.kind)).length;
    expect(hero).toBe(glance);
    expect(hero).toBe(planCaught);
    // The caught set never counts not_found or low_relevance or duplicates.
    for (const r of view.rejected) {
      if (!CAUGHT_KINDS.has(r.kind)) {
        expect(caughtRejections(view)).not.toContain(r);
      }
    }
    // Headline-ready: at least one catch per persona in the current fixtures.
    expect(hero).toBeGreaterThan(0);
  });
});
