"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { EraHero } from "@/components/session/era-hero";
import { PlanTimeline } from "@/components/session/plan-timeline";
import { ReasoningTrace } from "@/components/session/reasoning-trace";
import { resolveSource } from "@/components/session/source";
import { TourCaption } from "@/components/tour/tour-caption";
import { TourOverlay } from "@/components/tour/tour-overlay";
import {
  initialIndex,
  nextIndex,
  parseAutoplay,
  parseSpeed,
  parseStartPersona,
  TOUR_HOLD_MS,
  TOUR_PERSONAS,
} from "@/components/tour/tour-cycle";
import { useAgentStream } from "@/hooks/use-agent-stream";
import { MessagesProvider } from "@/i18n/provider";
import { getPersona } from "@/lib/personas";
import { cn } from "@/lib/utils";

/**
 * The judge-tour. Cycles Maria, Fatima, Seamus using the committed replay
 * fixtures via the existing NDJSON machinery. Each persona plays its trace;
 * when `done` fires the tour holds on the composed plan for 5 seconds then
 * advances. On the third persona it loops back to Maria. Pause is sticky:
 * once a judge pauses, nothing advances until they tap play (or hit space).
 *
 * The tour never calls live Qloo or Gemini: `resolveSource("replay", ...)`
 * reads the committed trace fixtures. A Gemini outage cannot break it.
 */
export function TourPlayer() {
  const params = useSearchParams();
  const router = useRouter();
  const speed = parseSpeed(params.get("speed"));
  const startSlug = parseStartPersona(params.get("start"));
  const autoplay = parseAutoplay(params.get("autoplay"));

  const [index, setIndex] = useState(() => initialIndex(startSlug));
  const [paused, setPaused] = useState(() => !autoplay);
  const [runId, setRunId] = useState(0);
  // `prefers-reduced-motion` defers auto-advance: a judge who dislikes motion
  // can tap Next or hit the right arrow to move through at their own pace.
  // useSyncExternalStore keeps SSR snapshots stable and subscribes without
  // triggering a cascading effect-driven setState.
  const reducedMotion = useSyncExternalStore(
    (callback) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      mq.addEventListener("change", callback);
      return () => mq.removeEventListener("change", callback);
    },
    () => (typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false),
    () => false,
  );

  const slug = TOUR_PERSONAS[index];
  // Non-null: TOUR_PERSONAS entries are all registered personas.
  const persona = useMemo(() => getPersona(slug)!, [slug]);
  const name = persona.card.name.split(",")[0];
  const sessionLanguage = persona.input.sessionLanguage ?? "en";
  const caregiverLanguage = persona.input.caregiverLanguage ?? "en";

  const source = useMemo(
    () => resolveSource("replay", { speed, hasRecording: true, language: sessionLanguage, personaSlug: slug }),
    [slug, speed, sessionLanguage],
  );
  const { view, start, cancel } = useAgentStream(source, caregiverLanguage);

  // Start / restart the stream when the persona changes or the user hits
  // "restart current" (left arrow bumps runId). Deps are intentionally minimal
  // so a stale closure cannot double-start a stream.
  useEffect(() => {
    start({ mode: "grounded", person: persona.input });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, runId]);

  // Hold on the composed plan, then advance. Paused and reduced-motion both
  // disable the timer; the latter is reset only by a manual action.
  useEffect(() => {
    if (view.status !== "done" || paused || reducedMotion) return;
    const timer = setTimeout(() => setIndex((i) => nextIndex(i)), TOUR_HOLD_MS);
    return () => clearTimeout(timer);
  }, [view.status, paused, reducedMotion]);

  const togglePause = () => setPaused((p) => !p);
  const advance = () => setIndex((i) => nextIndex(i));
  const restartCurrent = () => setRunId((n) => n + 1);
  const goHome = () => router.push("/");

  // Keyboard shortcuts: space pauses/resumes, right arrow advances, left
  // arrow restarts the current persona, Esc returns home. Form fields are
  // excluded so a judge who tabs into a field can still type a space.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      if (e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        togglePause();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        advance();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        restartCurrent();
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancel();
        goHome();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // togglePause/advance/restartCurrent/goHome are stable updates; cancel is
    // a hook-returned ref callback that is also stable per source.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cancel]);

  const plan = view.plan;
  const streaming = view.status === "streaming";
  const traceWide = streaming && view.steps.length === 0;

  return (
    <MessagesProvider language={caregiverLanguage}>
      <TourOverlay
        name={name}
        current={index + 1}
        total={TOUR_PERSONAS.length}
        index={index}
        paused={paused}
        onToggle={togglePause}
        onNext={advance}
      />
      <div className="flex flex-col gap-6 pb-24" data-testid="tour-view" data-status={view.status} data-persona={slug}>
        <EraHero
          persona={slug}
          anchors={view.anchors}
          plan={plan}
          birthPlace={persona.input.birthPlace}
          birthYear={persona.input.birthYear}
          sessionLanguage={sessionLanguage}
          streaming={streaming}
        />
        <h1 className="text-3xl leading-tight font-semibold sm:text-4xl" data-testid="tour-title" lang={plan?.language}>
          {plan?.title ?? name}
        </h1>
        <div className={cn("grid items-start gap-6", !traceWide && "lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]")}>
          <ReasoningTrace view={view} className="max-h-[60dvh] lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)]" />
          {!traceWide && (
            <PlanTimeline
              className="animate-in duration-500 fade-in slide-in-from-right-8 motion-reduce:animate-none"
              view={view}
              language={sessionLanguage}
              caregiverLanguage={caregiverLanguage}
            />
          )}
        </div>
      </div>
      <TourCaption view={view} />
    </MessagesProvider>
  );
}
