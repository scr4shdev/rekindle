import { describe, expect, it } from "vitest";

import { wouldSlip } from "@/components/compare/would-slip";
import type { RejectedItem } from "@/lib/domain/types";

/**
 * The compare view flags an LLM step as "Would have slipped" when its title
 * echoes a rejected label. This is a deterministic shape rule: at least two
 * shared tokens (length >= 4). An earlier version used a hand-authored stop
 * list of place names and demo first names to let a single rare proper noun
 * flag on its own; that stop list was a keyword list for semantics, which
 * AGENTS.md bans. The pure-shape replacement is less sharp but honest.
 */
describe("compare wouldSlip", () => {
  function rejected(label: string, kind: RejectedItem["kind"] = "not_found"): RejectedItem {
    return { label, reason: "", kind, phase: "verify", domain: "music" };
  }

  it("does NOT flag a step that only shares a single place token", () => {
    // Carosone's "Napoli Mia Bella" is a verified entity; it must not flag
    // just because "napoli" also appears in the rejected label.
    const slip = wouldSlip("Renato Carosone, 'Napoli Mia Bella' (1957)", [
      rejected("Festival di Napoli 1958"),
    ]);
    expect(slip).toBeUndefined();
  });

  it("does NOT flag a step that shares only a single proper-noun token", () => {
    // "Diego Maradona" rejected on anachronism grounds. A step title that
    // mentions "Maradona" alone no longer flags: a single shared token is
    // not enough. (An LLM-based judgment on the server would be needed to
    // reinstate single-token flagging; see docs/no-regex-semantics.md.)
    const item = rejected("Diego Maradona", "anachronism");
    const slip = wouldSlip("Maradona and the 1987 scudetto", [item]);
    expect(slip).toBeUndefined();
  });

  it("flags a step that shares two or more tokens with a rejected label", () => {
    const item = rejected("Festival di Napoli 1958");
    const slip = wouldSlip("The Festival di Napoli 1958", [item]);
    expect(slip).toBe(item);
  });

  it("does NOT flag on a shared bare year alone", () => {
    const slip = wouldSlip("A quiet song from 1958", [rejected("Festival di Napoli 1958")]);
    expect(slip).toBeUndefined();
  });

  it("flags on two shared tokens even when one is a year", () => {
    const item = rejected("Festival di Napoli 1958");
    const slip = wouldSlip("Festival night 1958", [item]);
    expect(slip).toBe(item);
  });
});
