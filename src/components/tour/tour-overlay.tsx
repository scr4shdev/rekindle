"use client";

import Link from "next/link";
import { HomeIcon, PauseIcon, PlayIcon, SkipForwardIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMessages } from "@/i18n/provider";
import { cn } from "@/lib/utils";

/**
 * Top-right overlay for the judge tour: badge ("Tour: Maria 1 of 3"), a row of
 * progress dots, and pause / play / next controls. Non-promotional and quiet
 * on purpose: it must not pull attention from the composed plan.
 */
export function TourOverlay({
  name,
  current,
  total,
  index,
  paused,
  onToggle,
  onNext,
}: {
  name: string;
  current: number;
  total: number;
  index: number;
  paused: boolean;
  onToggle: () => void;
  onNext: () => void;
}) {
  const t = useMessages().tour;
  return (
    <aside
      aria-label="Tour controls"
      data-testid="tour-overlay"
      className="pointer-events-auto fixed top-20 right-4 z-30 flex flex-col items-end gap-2 sm:top-24 sm:right-6"
    >
      <div className="flex items-center gap-3 rounded-full border border-border bg-card/95 px-4 py-2 shadow-paper backdrop-blur">
        <p className="font-heading text-sm font-semibold whitespace-nowrap" data-testid="tour-badge">
          {t.badge({ name, current, total })}
        </p>
        <ol className="flex items-center gap-1.5" aria-hidden>
          {Array.from({ length: total }, (_, i) => (
            <li
              key={i}
              className={cn(
                "size-2 rounded-full transition-colors",
                i === index ? "bg-foreground" : "bg-muted-foreground/30",
              )}
            />
          ))}
        </ol>
      </div>
      <div className="flex items-center gap-2 rounded-full border border-border bg-card/95 px-2 py-1.5 shadow-paper backdrop-blur">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onToggle}
          data-testid="tour-toggle"
          aria-label={paused ? t.play : t.pause}
          aria-pressed={paused ? "false" : "true"}
          data-icon="inline-start"
        >
          {paused ? <PlayIcon aria-hidden /> : <PauseIcon aria-hidden />}
          <span>{paused ? t.play : t.pause}</span>
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onNext}
          data-testid="tour-next"
          aria-label={t.next}
          data-icon="inline-start"
        >
          <SkipForwardIcon aria-hidden />
          <span>{t.next}</span>
        </Button>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-sm text-muted-foreground hover:text-foreground focus-visible:text-foreground"
          data-testid="tour-home"
        >
          <HomeIcon className="size-4" aria-hidden />
          <span>{t.returnHome}</span>
        </Link>
      </div>
    </aside>
  );
}
