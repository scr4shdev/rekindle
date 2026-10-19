import { describe, expect, it } from "vitest";

import { wouldSlip } from "@/components/compare/would-slip";
import type { RejectedItem } from "@/lib/domain/types";

/**
 * The compare view flags an LLM step as "Would have slipped" when its title
 * echoes a rejected label. The naive token-match was too loose: a shared
 * place token like "napoli" would flag a legit grounded entity ("Napoli Mia
 * Bella") against a rejected "Festival di Napoli 1958". The fix requires at
 * least one shared token to be specific — not a place, demo first-name, or
 * bare year.
 */
describe("compare wouldSlip", () => {
  function rejected(label: string, kind: RejectedItem["kind"] = "not_found"): RejectedItem {
    return { label, reason: "", kind, phase: "verify", domain: "music" };
  }

  it("does NOT flag a legit grounded step that only shares a place token with a rejected label", () => {
    // Carosone's "Napoli Mia Bella" is a verified entity in the Maria demo;
    // it must not be marked as a slip just because "napoli" appears in the
    // rejected "Festival di Napoli 1958".
    const slip = wouldSlip("Renato Carosone, 'Napoli Mia Bella' (1957)", [
      rejected("Festival di Napoli 1958"),
    ]);
    expect(slip).toBeUndefined();
  });

  it("flags a step whose title shares the specific proper-noun token with a rejected label", () => {
    // Diego Maradona was rejected on anachronism grounds; the step title
    // "Maradona and the 1987 scudetto" shares the specific token "maradona"
    // and should be flagged.
    const item = rejected("Diego Maradona", "anachronism");
    const slip = wouldSlip("Maradona and the 1987 scudetto", [item]);
    expect(slip).toBe(item);
  });

  it("flags a step that echoes a rejected label by its distinctive token even when stop-listed tokens overlap too", () => {
    // "The Festival di Napoli 1958" overlaps the rejected label on "festival"
    // (specific), "napoli" (place, stop-listed) and "1958" (year). The
    // specific token is enough to flag it.
    const item = rejected("Festival di Napoli 1958");
    const slip = wouldSlip("The Festival di Napoli 1958", [item]);
    expect(slip).toBe(item);
  });

  it("does NOT flag on a shared bare year alone", () => {
    const slip = wouldSlip("A quiet song from 1958", [rejected("Festival di Napoli 1958")]);
    expect(slip).toBeUndefined();
  });
});
