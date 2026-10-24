import type { Metadata } from "next";
import { Suspense } from "react";
import { TourPlayer } from "@/components/tour/tour-player";
import { getMessages } from "@/i18n";

const t = getMessages().app;

export const metadata: Metadata = {
  title: `Tour · ${t.name}`,
  description: "A hands-off cycle through three recorded Rekindle sessions. Maria, Fatima, Seamus.",
};

/**
 * `/tour`: the judge-ready auto-play surface. Cycles Maria, Fatima, Seamus
 * from their committed replay traces so a demo-day visitor with ninety
 * seconds sees the agent loop three times, on three cultures, without typing.
 *
 * URL params:
 *   - `autoplay=1` (default): the tour starts cycling immediately.
 *   - `start=fatima`: begin on a specific persona.
 *   - `speed=2`: pass-through to the existing replay speed.
 */
export default function TourPage() {
  return (
    <main id="main" className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 pt-2 pb-16 sm:px-8">
      <Suspense fallback={<div className="h-96 animate-pulse rounded-3xl bg-muted" aria-hidden />}>
        <TourPlayer />
      </Suspense>
    </main>
  );
}
