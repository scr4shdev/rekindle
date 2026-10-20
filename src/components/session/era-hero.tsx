"use client";

import { useMessages } from "@/i18n/provider";
import type { Anchors, LifePhase, LifePhaseLabel, SessionPlan } from "@/lib/domain/types";
import { cn } from "@/lib/utils";

function languageNames(anchors: Anchors): string {
  return anchors.languages.map((l) => l.name).join(", ");
}

/** Reminiscence-bump years: roughly 12-25 after birth. */
function formativeFromBirth(birthYear?: number): { startYear: number; endYear: number } | undefined {
  if (!birthYear) return undefined;
  return { startYear: birthYear + 12, endYear: birthYear + 25 };
}

const PERSONA_HERO_TONE: Record<string, string> = {
  // Napoli: terracotta sun. Cork: sea-green. Fès: lamp-amber.
  maria: "from-ochre-soft via-paper-deep to-rose-soft/60",
  seamus: "from-sage-soft via-paper-deep to-sage-soft/40",
  fatima: "from-ochre-soft via-paper-deep to-ochre-soft/60",
  custom: "from-paper-deep via-paper-deep to-sage-soft/40",
};

// Soft Lamplight tones per phase (childhood through later_life), dark-mode safe
// because every token redefines itself in .dark.
const PHASE_TONE: Record<LifePhaseLabel, string> = {
  childhood: "bg-sage-soft",
  youth: "bg-muted",
  early_adulthood: "bg-ochre-soft",
  mid_life: "bg-rose-soft",
  later_life: "bg-clay-soft",
};
const PHASE_ORDER: LifePhaseLabel[] = ["childhood", "youth", "early_adulthood", "mid_life", "later_life"];

/**
 * Horizontal phase timeline: five bands proportional to the year span of each
 * life phase, dimmed when the band is outside the person's lifetime window.
 * Dots mark every composed step at its entity year. Purely informational, no
 * interaction beyond hover (and tap, via title on touch devices).
 */
function PhaseTimeline({ anchors, plan }: { anchors: Anchors; plan: SessionPlan | undefined }) {
  const t = useMessages().session;
  const phases = anchors.lifePhases;
  if (!phases || phases.length === 0) return null;
  const totalSpan = phases.reduce((n, p) => n + Math.max(1, p.endYear - p.startYear + 1), 0);
  const lifeStart = anchors.lifetimeWindow?.startYear ?? phases[0].startYear;
  const lifeEnd = anchors.lifetimeWindow?.endYear ?? phases[phases.length - 1].endYear;
  const timelineStart = phases[0].startYear;
  const timelineEnd = phases[phases.length - 1].endYear;
  const timelineSpan = Math.max(1, timelineEnd - timelineStart);
  const byLabel = new Map<LifePhaseLabel, LifePhase>(phases.map((p) => [p.label, p]));
  const steps = plan?.steps ?? [];
  return (
    <div
      aria-label={t.phaseTimelineLabel}
      role="group"
      data-testid="phase-timeline"
      className="relative mt-4 flex h-10 w-full overflow-hidden rounded-full border border-border/60 shadow-paper"
    >
      {PHASE_ORDER.map((label) => {
        const phase = byLabel.get(label);
        if (!phase) return null;
        const span = Math.max(1, phase.endYear - phase.startYear + 1);
        const width = (span / totalSpan) * 100;
        const outside = phase.endYear < lifeStart || phase.startYear > lifeEnd;
        return (
          <div
            key={label}
            className={cn(
              "relative flex items-center justify-center overflow-hidden border-r border-border/40 px-1 last:border-r-0",
              PHASE_TONE[label],
              outside && "opacity-30",
            )}
            style={{ width: `${width}%` }}
            data-phase={label}
            data-outside={outside || undefined}
          >
            <span className="truncate text-[0.65rem] font-semibold tracking-wide text-foreground/75 uppercase sm:text-xs">
              {t.phaseBands[label]}
            </span>
            <span className="sr-only"> {t.phaseYears(phase.startYear, phase.endYear)}</span>
          </div>
        );
      })}
      {steps.map((step) => {
        const year = step.entity?.releaseYear;
        if (!year) return null;
        if (year < timelineStart || year > timelineEnd) return null;
        const left = ((year - timelineStart) / timelineSpan) * 100;
        const label = t.phaseStep(step.title, year);
        return (
          <span
            key={step.id}
            className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-background bg-foreground/70 shadow-sm hover:scale-125 hover:bg-foreground motion-reduce:hover:scale-100"
            style={{ left: `${left}%` }}
            data-testid="phase-step-dot"
            aria-label={label}
            title={label}
            tabIndex={0}
          />
        );
      })}
    </div>
  );
}

/**
 * Place + era + session-language hero band. Visible from first paint (fed from
 * the request's person info) so a judge is not staring at an empty header while
 * the agent streams; once PARSE lands, anchors refine place and years. The one-
 * line lifespan summary stays sr-only once the agent has composed phases: the
 * PhaseTimeline carries the same information visually.
 */
export function EraHero({
  persona,
  anchors,
  plan,
  birthPlace,
  birthYear,
  sessionLanguage,
  streaming,
}: {
  persona: string;
  anchors: Anchors | undefined;
  plan: SessionPlan | undefined;
  birthPlace: string | undefined;
  birthYear: number | undefined;
  sessionLanguage: string;
  streaming: boolean;
}) {
  const t = useMessages().session;
  const place = anchors?.places[0]?.name ?? birthPlace;
  const window = anchors?.formativeWindow ?? formativeFromBirth(birthYear);
  const languageLabel = anchors
    ? languageNames(anchors)
    : (() => {
        try {
          return new Intl.DisplayNames([sessionLanguage], { type: "language" }).of(sessionLanguage) ?? sessionLanguage;
        } catch {
          return sessionLanguage;
        }
      })();
  if (!place && !window) return null;
  const tone = PERSONA_HERO_TONE[persona] ?? PERSONA_HERO_TONE.custom;
  return (
    <section
      aria-label={t.eraBandLabel}
      data-testid="era-hero"
      data-streaming={streaming || undefined}
      className={cn(
        "animate-rise relative overflow-hidden rounded-3xl border border-border bg-gradient-to-br px-5 py-5 transition-[padding] duration-500 motion-reduce:transition-none sm:px-8",
        tone,
        streaming ? "sm:py-9" : "sm:py-5",
      )}
      lang={sessionLanguage}
    >
      <div className="flex flex-col items-baseline gap-x-5 gap-y-1 sm:flex-row sm:flex-wrap">
        {place && (
          <h2
            className={cn(
              "font-heading font-semibold leading-[1.05] text-foreground transition-[font-size] duration-500 motion-reduce:transition-none",
              streaming ? "text-4xl sm:text-6xl" : "text-2xl sm:text-4xl",
            )}
          >
            {place}
          </h2>
        )}
        {window && (
          <p
            className={cn(
              "font-heading font-semibold text-sage-ink transition-[font-size] duration-500 motion-reduce:transition-none",
              streaming ? "text-2xl sm:text-4xl" : "text-xl sm:text-2xl",
            )}
          >
            · {window.startYear}–{window.endYear}
          </p>
        )}
        <p className="text-sm font-semibold tracking-wide text-muted-foreground uppercase sm:text-base">
          {languageLabel}
        </p>
      </div>
      {anchors?.lifePhases && anchors.lifePhases.length > 0 && (
        <>
          <p className="sr-only" data-testid="era-hero-lifespan">
            {t.lifespan(anchors.lifePhases[0].startYear, anchors.lifePhases[anchors.lifePhases.length - 1].endYear)}
          </p>
          <PhaseTimeline anchors={anchors} plan={plan} />
        </>
      )}
    </section>
  );
}
