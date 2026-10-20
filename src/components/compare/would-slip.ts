import type { RejectedItem } from "@/lib/domain/types";

/**
 * Deterministic shape-only comparison between an LLM-only step title and the
 * grounded-mode rejection list. Flags a step when it shares two or more
 * meaningful tokens with a rejected label.
 *
 * This file used to carry a hand-authored stop list of place names and demo
 * first names so a single shared "napoli" or "maria" would not trigger a
 * false flag. That stop list was a keyword list for semantics (deciding
 * which tokens are "generic") and AGENTS.md bans those: all meaning goes
 * through the LLM via schema-validated structured output. The pure-shape
 * replacement is less sharp (a single rare proper noun no longer flags on
 * its own) but it is honest: anything stronger needs an LLM-based judgment
 * on the server side.
 */

/** Lower-cased, non-alphanumeric collapsed, length >= 4 tokens. */
export function labelTokens(label: string): string[] {
  return label
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/u)
    .filter((w) => w.length >= 4);
}

/** Minimum number of distinct shared tokens that triggers a slip match. */
const MIN_SHARED_TOKENS = 2;

/**
 * Return the rejected item that shares at least `MIN_SHARED_TOKENS` tokens
 * with the step title, or undefined. The rule is pure set overlap on the
 * tokens produced by `labelTokens`.
 */
export function wouldSlip(stepTitle: string, rejected: RejectedItem[]): RejectedItem | undefined {
  const titleSet = new Set(labelTokens(stepTitle));
  for (const item of rejected) {
    const tokens = new Set(labelTokens(item.label));
    let shared = 0;
    for (const tok of tokens) {
      if (titleSet.has(tok)) shared += 1;
      if (shared >= MIN_SHARED_TOKENS) return item;
    }
  }
  return undefined;
}
