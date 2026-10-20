import type { RejectedItem } from "@/lib/domain/types";

/**
 * Tokens that are too generic (places, invented person names, bare years)
 * to trigger a slip match on their own. A rejected "Festival di Napoli 1958"
 * must not flag any step whose title merely shares "napoli" or "1958": one
 * of the other tokens (festival) must match too, otherwise a legit grounded
 * entity like "Napoli Mia Bella" gets a false "Would have slipped" badge.
 */
const SLIP_STOP_TOKENS = new Set([
  "napoli",
  "naples",
  "cork",
  "brussels",
  "fes",
  "fès",
  "fez",
  "maria",
  "seamus",
  "fatima",
]);
const SLIP_YEAR_RE = /^\d{4}$/;

function isSlipStopToken(tok: string): boolean {
  return SLIP_STOP_TOKENS.has(tok) || SLIP_YEAR_RE.test(tok);
}

/** Significant-word tokens from a rejection label or step title. */
export function labelTokens(label: string): string[] {
  return label
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4);
}

/**
 * True when a step title shares meaningful tokens with a rejected label AND
 * at least one of those shared tokens is specific (not a stop-listed place,
 * demo first-name, or bare year). Prevents a legit grounded entity (e.g.
 * "Carosone, 'Napoli Mia Bella'") from being flagged just because it shares
 * "napoli" with a rejected "Festival di Napoli 1958".
 */
export function wouldSlip(stepTitle: string, rejected: RejectedItem[]): RejectedItem | undefined {
  const titleSet = new Set(labelTokens(stepTitle));
  for (const item of rejected) {
    const tokens = labelTokens(item.label);
    if (tokens.length === 0) continue;
    const matched = tokens.filter((tok) => titleSet.has(tok));
    if (matched.length === 0) continue;
    if (matched.some((tok) => !isSlipStopToken(tok))) return item;
  }
  return undefined;
}
