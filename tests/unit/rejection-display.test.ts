/**
 * Rejection display helper: compare & trace screens must never show
 * "Wrong place" for a cultural-mismatch rejection and never leak the
 * `cultural_mismatch:` sentinel into the user-visible reason text.
 */
import { describe, expect, it } from "vitest";

import { CULTURAL_MISMATCH_PREFIX, rejectionDisplay } from "@/components/session/rejection-display";
import type { RejectedItem } from "@/lib/domain/types";

const base = {
  label: "A US public figure",
  domain: "public_figure" as const,
  phase: "critique" as const,
  refId: "m1",
};

describe("rejectionDisplay (compare + reasoning trace)", () => {
  it("renders a cultural-mismatch rejection with the honest sub-badge and a prefix-free reason", () => {
    const item: RejectedItem = {
      ...base,
      kind: "wrong_locale",
      reason: `${CULTURAL_MISMATCH_PREFIX} US public figure, far from a Fès-born Arabic-speaker's circle.`,
    };
    const display = rejectionDisplay(item);
    expect(display.label).toBe("Doesn't fit culture");
    expect(display.reason).toBe("US public figure, far from a Fès-born Arabic-speaker's circle.");
    expect(display.reason.toLowerCase()).not.toContain("cultural_mismatch:");
  });

  it("recognises the sentinel case-insensitively and tolerates leading whitespace", () => {
    const item: RejectedItem = {
      ...base,
      kind: "wrong_locale",
      reason: "   Cultural_Mismatch:   trimmed reason here.",
    };
    const display = rejectionDisplay(item);
    expect(display.label).toBe("Doesn't fit culture");
    expect(display.reason).toBe("trimmed reason here.");
  });

  it("keeps the frozen Wrong-place badge for a genuine locale mismatch (no sentinel)", () => {
    const item: RejectedItem = {
      ...base,
      kind: "wrong_locale",
      reason: "This item is tied to a different region.",
    };
    const display = rejectionDisplay(item);
    expect(display.label).toBe("Wrong place");
    expect(display.reason).toBe("This item is tied to a different region.");
  });

  it("leaves other rejection kinds untouched", () => {
    const item: RejectedItem = {
      ...base,
      kind: "anachronism",
      reason: "Released after their formative years.",
    };
    const display = rejectionDisplay(item);
    expect(display.label).toBe("Wrong era");
    expect(display.reason).toBe("Released after their formative years.");
  });
});
