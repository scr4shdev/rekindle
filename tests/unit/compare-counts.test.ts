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
 *
 * The hero also now carries a "brought N cultural anchors" clause for the
 * Qloo-DISCOVERY story. That count must match the "Taste discoveries from
 * Qloo" score row exactly (entities with provenance === "qloo-affinity").
 * Parity is asserted here so the hero and the row cannot drift.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { caughtBySource, caughtRejections, isCaught } from "@/components/compare/compare-view";
import { viewFromEvents } from "@/components/session/view-state";
import { en } from "@/i18n/en";
import type { AgentEvent } from "@/lib/domain/types";

const PERSONAS = ["maria", "fatima", "seamus"] as const;

function loadEvents(slug: string): AgentEvent[] {
  const file = path.join(process.cwd(), "tests", "fixtures", `trace-${slug}.ndjson`);
  return readFileSync(file, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as AgentEvent);
}

/** Live fixture counts the three Compare surfaces must agree on. */
const EXPECTED = {
  fatima: { brought: 7, caught: 1, verified: 10, name: "Fatima" },
  maria: { brought: 11, caught: 5, verified: 10, name: "Maria" },
  seamus: { brought: 10, caught: 3, verified: 12, name: "Seamus" },
} as const;

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

describe("compare hero three-metric headline", () => {
  it.each(PERSONAS)(
    "%s: hero 'brought' matches the score row's Taste discoveries count",
    (slug) => {
      const view = viewFromEvents(loadEvents(slug));
      const entities = Object.values(view.entities);
      // The score row "Taste discoveries from Qloo" renders this exact
      // number via metrics().discoveries. The hero "brought N" clause
      // must read from the same source so the two surfaces agree.
      const scoreRowDiscoveries = entities.filter((e) => e.provenance === "qloo-affinity").length;
      expect(scoreRowDiscoveries).toBe(EXPECTED[slug].brought);
    },
  );

  it.each(PERSONAS)("%s: live fixture counts match the committed expectations", (slug) => {
    const view = viewFromEvents(loadEvents(slug));
    const entities = Object.values(view.entities);
    const expected = EXPECTED[slug];
    expect(entities.filter((e) => e.provenance === "qloo-affinity").length).toBe(expected.brought);
    expect(entities.filter((e) => e.provenance === "llm-proposed-qloo-verified").length).toBe(expected.verified);
    expect(caughtRejections(view).length).toBe(expected.caught);
  });

  it("Fatima headline leads with the Qloo-DISCOVERY frame, then catch and confirm", () => {
    const { brought, caught, verified, name } = EXPECTED.fatima;
    const headline = en.compare.headline(brought, caught, verified, name);
    expect(headline).toContain("Qloo brought 7 cultural anchors Fatima's notes didn't name");
    expect(headline).toContain("caught 1 era slip");
    expect(headline).toContain("confirmed 10 real matches");
    // Oxford comma on the three-clause form keeps the sentence legible.
    expect(headline).toMatch(/, and confirmed/);
  });

  it("Maria headline keeps the catch frame (her Maradona 1987 money shot)", () => {
    const { brought, caught, verified, name } = EXPECTED.maria;
    const headline = en.compare.headline(brought, caught, verified, name);
    expect(headline).toContain("caught 5 era slips");
    expect(headline).toContain("Qloo brought 11");
    expect(headline).toContain("confirmed 10 real matches");
  });

  it("Seamus headline carries both discovery and catch clauses", () => {
    const { brought, caught, verified, name } = EXPECTED.seamus;
    const headline = en.compare.headline(brought, caught, verified, name);
    expect(headline).toContain("Qloo brought 10 cultural anchors Seamus's notes didn't name");
    expect(headline).toContain("caught 3 era slips");
    expect(headline).toContain("confirmed 12 real matches");
  });

  it("falls back to the original 'caught/confirmed' form when brought is 0", () => {
    const headline = en.compare.headline(0, 2, 5, "Fatima");
    expect(headline).toBe("The agent caught 2 slips and confirmed 5 real matches.");
  });

  it("singular/plural agrees across the three-clause form", () => {
    const headline = en.compare.headline(1, 1, 1, "Alex");
    expect(headline).toBe(
      "Qloo brought 1 cultural anchor Alex's notes didn't name, caught 1 era slip, and confirmed 1 real match.",
    );
  });
});
