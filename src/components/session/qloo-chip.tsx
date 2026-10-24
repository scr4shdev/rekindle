"use client";

/**
 * E1: small sage "Qloo chip" rendered under each grounded body step, on both
 * the plan view and the printable session card. Explains the connection
 * ("linked to X" for an expanded anchor, "confirmed Y era" for a verified
 * anchor) so a judge who only reads the plan still sees Qloo doing work.
 *
 * The chip is composed from the step's qlooProvenance (aggregate seed and
 * tag names, HARD RULE 3) plus the entity's releaseYear. Picks up to two
 * context tokens; when nothing useful is left (opening/closing steps,
 * llm-only steps, or missing provenance), returns null so the plan step
 * keeps its current look.
 *
 * The pure composition is factored out as `qlooChipSpec` so the unit test
 * can exercise the determinism rule without a React test renderer.
 */
import { useMessages } from "@/i18n/provider";
import type { SessionStep } from "@/lib/domain/types";

export interface QlooChipSpec {
  variant: "linked" | "confirmed";
  /** Up to two short context tokens, caller-rendered into the i18n template. */
  tokens: string[];
}

/**
 * Deterministic chip spec for a step. Returns undefined when there is nothing
 * useful to say; the caller then skips rendering so the layout is unchanged.
 */
export function qlooChipSpec(
  step: SessionStep,
  eraTemplate: (year: number) => string,
): QlooChipSpec | undefined {
  const prov = step.qlooProvenance;
  if (!prov) return undefined;
  if (step.provenance !== "qloo-grounded") return undefined;
  // Body steps only: opening and closing are warm scaffolding, not anchors.
  if (step.kind === "opening" || step.kind === "closing") return undefined;

  const tokens: string[] = [];
  if (prov.kind === "expanded") {
    for (const seed of prov.seeds) {
      if (tokens.length >= 2) break;
      const trimmed = seed.trim();
      if (trimmed) tokens.push(trimmed);
    }
    if (tokens.length === 0) {
      for (const tag of prov.tags) {
        if (tokens.length >= 2) break;
        const trimmed = tag.trim();
        if (trimmed) tokens.push(trimmed);
      }
    }
    if (tokens.length === 0) return undefined;
    return { variant: "linked", tokens };
  }

  // verified
  const year = step.entity?.releaseYear;
  if (year !== undefined) tokens.push(eraTemplate(year));
  for (const tag of prov.tags) {
    if (tokens.length >= 2) break;
    const trimmed = tag.trim();
    if (trimmed) tokens.push(trimmed);
  }
  if (tokens.length === 0) return undefined;
  return { variant: "confirmed", tokens };
}

/**
 * Chip view. Returns `null` when there is nothing to say, so the surrounding
 * card layout is unchanged for opening, closing and llm-only steps.
 */
export function QlooChip({ step }: { step: SessionStep }) {
  const t = useMessages().qloo;
  const spec = qlooChipSpec(step, t.chipEra);
  if (!spec) return null;
  const context = spec.tokens.join(", ");
  const text = spec.variant === "linked" ? t.chipLinked(context) : t.chipConfirmed(context);
  return (
    <p
      className="line-clamp-2 inline-flex max-w-full rounded-full bg-sage-soft px-2.5 py-1 text-xs font-medium text-sage-ink"
      data-testid="qloo-chip"
      data-chip-variant={spec.variant}
    >
      {text}
    </p>
  );
}
