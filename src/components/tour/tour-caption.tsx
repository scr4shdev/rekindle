"use client";

import { useMessages } from "@/i18n/provider";
import type { SessionView } from "@/components/session/view-state";
import { captionLabel } from "@/components/tour/tour-cycle";

/**
 * Bottom caption bar: the current agent phase, in caregiver language. Copy
 * comes straight from `trace.phases.*` so a judge sees the same wording that
 * labels the reasoning trace. Hidden when the tour has not started yet.
 */
export function TourCaption({ view }: { view: SessionView }) {
  const messages = useMessages();
  const phases = messages.trace.phases;
  if (view.status === "idle") return null;
  const label = captionLabel(view, phases);
  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      data-testid="tour-caption"
      className="pointer-events-none fixed inset-x-0 bottom-20 z-30 flex justify-center px-4 sm:bottom-24"
    >
      <p className="pointer-events-auto rounded-full border border-border bg-card/95 px-5 py-2 font-heading text-sm font-semibold shadow-paper backdrop-blur sm:text-base">
        {label}
      </p>
    </div>
  );
}
