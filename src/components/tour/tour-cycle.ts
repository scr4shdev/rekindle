/**
 * Pure cycle logic for the judge-tour. No React, no I/O: tested directly in
 * `tests/unit/tour-cycle.test.ts`. The tour cycles through three recorded
 * personas with a short pause on each composed plan before advancing.
 */
import type { AgentPhase } from "@/lib/domain/types";
import type { SessionView } from "@/components/session/view-state";
import type { Messages } from "@/i18n";

/** Fixture-backed personas, in the order the tour visits them (Maria first). */
export const TOUR_PERSONAS = ["maria", "fatima", "seamus"] as const;
export type TourPersona = (typeof TOUR_PERSONAS)[number];

/** Hold on the composed plan after `done` before advancing to the next persona. */
export const TOUR_HOLD_MS = 5_000;

/** Normalise `?start=` to a known persona slug (default Maria). */
export function parseStartPersona(value: string | null | undefined): TourPersona {
  const slug = (value ?? "").toLowerCase();
  const match = TOUR_PERSONAS.find((p) => p === slug);
  return match ?? "maria";
}

/** Normalise `?speed=` to a positive number (default 1). */
export function parseSpeed(value: string | null | undefined): number {
  const n = Number(value ?? "1");
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** Normalise `?autoplay=` to a boolean (default true). "0" or "false" disables. */
export function parseAutoplay(value: string | null | undefined): boolean {
  if (value === null || value === undefined) return true;
  const v = value.toLowerCase();
  return v !== "0" && v !== "false";
}

/** Starting index into TOUR_PERSONAS for a `?start=` slug. */
export function initialIndex(start: TourPersona): number {
  const i = TOUR_PERSONAS.indexOf(start);
  return i < 0 ? 0 : i;
}

/** Next persona in the cycle, wrapping back to Maria after Seamus. */
export function nextIndex(current: number): number {
  return (current + 1) % TOUR_PERSONAS.length;
}

/**
 * Phase label for the caption bar. We pick the latest `started` phase, then
 * fall back to the latest `completed` one, then to the first phase. Labels
 * come from `trace.phases.*`: this reuses the existing i18n strings and never
 * duplicates them.
 */
export function captionLabel(view: SessionView, labels: Record<AgentPhase, string>): string {
  const started = [...view.phases].reverse().find((p) => p.status === "started");
  if (started) return labels[started.phase];
  const completed = [...view.phases].reverse().find((p) => p.status === "completed");
  if (completed) return labels[completed.phase];
  return labels.parse;
}

/** Render the "Tour: {name} {current} of {total}" badge from the tour i18n template. */
export function badgeText(messages: Messages, name: string, current: number, total: number): string {
  return messages.tour.badge({ name, current, total });
}
