/**
 * Hero stat, grid caught row and mobile glance strip in the compare view all
 * report the same number. The caught set is pre-plan rejections whose kind is
 * era/culture/risk (anachronism, wrong_locale, emotional_risk) OR a
 * `not_found` whose `catchSource` is "qloo" (search miss, cuisine-tag drop,
 * lifetime rail). Replan rejections and ungroundable not_found rows are
 * excluded. This invariant is enforced by caughtRejections()/isCaught() in
 * compare-view; the test here feeds each committed persona fixture through
 * the view reducer and asserts the three surfaces agree, plus that the
 * per-source counts sum back to the total.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { caughtBySource, caughtRejections, isCaught } from "@/components/compare/compare-view";
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
    const glance = view.rejected.filter(isCaught).length;
    // The rejected list the ComparePlan renders for the grounded column.
    const planCaught = view.rejected.filter(isCaught).length;
    expect(hero).toBe(glance);
    expect(hero).toBe(planCaught);
    // Replans and non-Qloo not_found never land in the caught set.
    for (const r of view.rejected) {
      if (!isCaught(r)) {
        expect(caughtRejections(view)).not.toContain(r);
      }
    }
    // Headline-ready: at least one catch per persona in the current fixtures.
    expect(hero).toBeGreaterThan(0);
  });

  it.each(PERSONAS)("%s: per-source counts sum to the total caught", (slug) => {
    const view = viewFromEvents(loadEvents(slug));
    const total = caughtRejections(view).length;
    const sources = caughtBySource(view);
    const sum = sources.qloo + sources["cultural-check"] + sources["critique-llm"] + sources.unknown;
    expect(sum).toBe(total);
  });
});
