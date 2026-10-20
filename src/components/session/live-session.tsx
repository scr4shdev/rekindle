"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CloudRainIcon,
  HeartHandshakeIcon,
  LanguagesIcon,
  LightbulbIcon,
  LoaderCircleIcon,
  MehIcon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
  SunIcon,
  WandSparklesIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { STEP_ICON } from "@/components/session/icons";
import { ListenButton } from "@/components/session/listen-button";
import { ProvenanceBadge, StepMedia } from "@/components/session/step-card";
import type { SessionView } from "@/components/session/view-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useMessages } from "@/i18n/provider";
import type { Reaction, SessionPlan } from "@/lib/domain/types";
import { cn } from "@/lib/utils";

const REACTIONS: { value: Reaction; icon: LucideIcon; tone: string; pulse: string }[] = [
  {
    value: "lit_up",
    icon: SunIcon,
    tone: "data-[selected=true]:bg-ochre-soft data-[selected=true]:border-ochre data-[selected=true]:text-ochre-ink",
    pulse: "animate-tap-sage",
  },
  {
    value: "neutral",
    icon: MehIcon,
    tone: "data-[selected=true]:bg-clay-soft data-[selected=true]:border-clay-ink data-[selected=true]:text-clay-ink",
    pulse: "animate-tap-ochre",
  },
  {
    value: "upset",
    icon: CloudRainIcon,
    tone: "data-[selected=true]:bg-rose-soft data-[selected=true]:border-rose data-[selected=true]:text-rose-ink",
    pulse: "animate-tap-rose",
  },
];

function formatTime(seconds: number) {
  const s = Math.max(0, seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

interface TimerState {
  key: string;
  /** Milliseconds counted before the current run started. */
  banked: number;
  /** Wall-clock start of the current run, or null when paused. */
  startedAt: number | null;
  /** Last wall-clock reading (updated by the tick). */
  now: number;
}

/**
 * Countdown for the current step, computed from elapsed wall-clock time (no
 * drift from interval jitter). Auto-starts on step entry: caregivers at the
 * bedside should never find a paused timer silently waiting on them.
 */
function useStepTimer(totalSeconds: number, resetKey: string) {
  const totalMs = totalSeconds * 1000;
  const [state, setState] = useState<TimerState>(() => {
    const now = Date.now();
    return { key: resetKey, banked: 0, startedAt: now, now };
  });
  // Reset during render when the step changes (no effect needed). Auto-start on entry.
  if (state.key !== resetKey) {
    // Reset-during-render reads the wall-clock to anchor the new step; the setState bailout
    // re-renders immediately, so the fresh Date.now() is read once per step entry.
    // eslint-disable-next-line react-hooks/purity
    const now = Date.now();
    setState({ key: resetKey, banked: 0, startedAt: now, now });
  }
  const running = state.startedAt !== null;
  const elapsed = state.banked + (state.startedAt !== null ? state.now - state.startedAt : 0);
  const left = Math.max(0, Math.ceil((totalMs - elapsed) / 1000));

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const now = Date.now();
      setState((s) => {
        if (s.startedAt === null) return s;
        const done = s.banked + (now - s.startedAt) >= totalMs;
        return done ? { ...s, banked: totalMs, startedAt: null, now } : { ...s, now };
      });
    }, 250);
    return () => clearInterval(id);
  }, [running, totalMs]);

  return {
    left,
    running,
    toggle: () =>
      setState((s) => {
        const now = Date.now();
        if (s.startedAt !== null) return { ...s, banked: s.banked + (now - s.startedAt), startedAt: null, now };
        return s.banked >= totalMs ? s : { ...s, startedAt: now, now };
      }),
    reset: () => setState((s) => ({ ...s, banked: 0, startedAt: null, now: 0 })),
  };
}

export function LiveSession({
  open,
  onOpenChange,
  view,
  plan,
  index,
  onIndexChange,
  reactions,
  onReact,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  view: SessionView;
  plan: SessionPlan;
  index: number;
  onIndexChange: (index: number) => void;
  reactions: Record<string, Reaction>;
  onReact: (stepId: string, reaction: Reaction) => void;
}) {
  const messages = useMessages();
  const t = messages.live;
  const ts = messages.step;
  const [showTranslation, setShowTranslation] = useState(true);
  // Focus the session itself on open, so Space toggles the timer instead of pressing Close.
  const popupRef = useRef<HTMLDivElement>(null);
  // The replan outcome stays in the bottom bar until the caregiver moves to another step.
  const [seenReplan, setSeenReplan] = useState(0);
  // Manual trigger for the closing moment (the Finish button). The derived `showClosing`
  // below adds the implicit case: timer reached zero on the last step.
  const [closingManual, setClosingManual] = useState(false);
  // Ephemeral feel-good tap feedback: a one-shot pulse on the tapped button and
  // a short reassurance line above the step card. `tapKey` reruns the pulse
  // animation when the same reaction is tapped on a new step.
  const [tapped, setTapped] = useState<{ reaction: Reaction; stepId: string; tapKey: number } | null>(null);
  useEffect(() => {
    if (!tapped) return;
    const id = setTimeout(() => setTapped(null), 1500);
    return () => clearTimeout(id);
  }, [tapped]);
  const go = (n: number) => {
    setSeenReplan(view.replans);
    setClosingManual(false);
    onIndexChange(n);
  };
  const steps = plan.steps;
  const i = Math.min(index, steps.length - 1);
  const step = steps[i];
  const next = steps[i + 1];
  const total = step.durationMin * 60;
  const timer = useStepTimer(total, step.id);
  const Icon = STEP_ICON[step.kind];
  const reaction = reactions[step.id];
  const replanPhase = view.phases.at(-1)?.phase === "replan" ? view.phases.at(-1) : undefined;
  const last = i === steps.length - 1;
  const outcome = view.lastReplan && view.lastReplan.n > seenReplan ? view.lastReplan.outcome : undefined;
  const notice =
    outcome === "adapted" && next
      ? { tone: outcome, text: t.adapted(next.title) }
      : outcome === "failed"
        ? { tone: outcome, text: t.adaptFailed }
        : outcome
          ? { tone: "unchanged" as const, text: t.unchanged }
          : undefined;
  // Only show a translation if it is actually a different reading of the prompt.
  const hasTranslation = Boolean(step.promptTranslation) && step.promptTranslation !== step.prompt;
  // The closing moment overlays the step view when triggered by the Finish button or when
  // the timer reaches zero on the last step.
  const showClosing = closingManual || (last && timer.left === 0);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, select")) return;
    if (event.key === "ArrowRight" && !last) go(i + 1);
    else if (event.key === "ArrowLeft" && i > 0) go(i - 1);
    else if (event.key === " " && !target.closest("button, a, summary")) {
      event.preventDefault();
      timer.toggle();
    } else return;
  }

  const progress = total > 0 ? 1 - timer.left / total : 0;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Popup
          className="fixed inset-0 z-50 flex flex-col bg-background outline-none data-closed:animate-out data-closed:fade-out-0 data-open:animate-in data-open:fade-in-0"
          ref={popupRef}
          initialFocus={popupRef}
          tabIndex={-1}
          onKeyDown={onKeyDown}
          data-testid="live-session"
        >
          {/* Top bar: progress and controls */}
          <div className="flex items-center gap-3 border-b border-border bg-paper-deep px-4 py-3 sm:px-8">
            <DialogPrimitive.Close render={<Button variant="ghost" size="icon" aria-label={t.close} />}>
              <XIcon aria-hidden />
            </DialogPrimitive.Close>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <DialogPrimitive.Title className="truncate text-[0.95rem] font-semibold text-muted-foreground">
                <span lang={plan.language}>{plan.title}</span> · {t.progress(i + 1, steps.length)}
              </DialogPrimitive.Title>
              <ol className="flex gap-1" aria-hidden>
                {steps.map((s, n) => (
                  <li
                    key={s.id}
                    className={cn("h-1.5 flex-1 rounded-full bg-border", n < i && "bg-sage", n === i && "bg-primary")}
                  />
                ))}
              </ol>
            </div>
            {hasTranslation && (
              <Button
                variant="outline"
                size="sm"
                aria-pressed={showTranslation}
                onClick={() => setShowTranslation((v) => !v)}
                data-icon="inline-start"
              >
                <LanguagesIcon aria-hidden />
                <span className="hidden sm:inline">{showTranslation ? t.hideTranslation : t.showTranslation}</span>
                <span className="sr-only sm:hidden">{showTranslation ? t.hideTranslation : t.showTranslation}</span>
              </Button>
            )}
          </div>

          {/* The prompt */}
          <div className="relative flex-1 overflow-y-auto" tabIndex={0} role="region" aria-label={t.title}>
            {tapped && (
              <p
                key={`${tapped.reaction}-${tapped.tapKey}`}
                role="status"
                aria-live="polite"
                data-testid="live-reassure"
                className="pointer-events-none absolute top-3 left-1/2 z-10 -translate-x-1/2 animate-reassure rounded-full bg-sage-soft px-4 py-1.5 text-sm font-semibold text-sage-ink shadow-paper sm:text-base"
              >
                {t.hearingYou}
              </p>
            )}
            <div
              key={step.id}
              className="mx-auto grid w-full max-w-5xl animate-rise gap-5 px-5 py-5 sm:px-8 sm:py-10 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:items-start"
            >
              <StepMedia step={step} large className="order-last h-36 rounded-3xl border border-border shadow-paper sm:h-56 md:order-first md:aspect-[4/5] md:h-auto" />
              <div className="flex flex-col gap-5">
                <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
                  <Icon className="size-6" aria-hidden />
                  <span className="text-lg font-semibold">{ts.kinds[step.kind]}</span>
                  <span>· {ts.minutes(step.durationMin)}</span>
                  {view.changedStepIds.includes(step.id) && <Badge variant="ochre">{ts.changed}</Badge>}
                  <span className="ml-auto">
                    <ProvenanceBadge step={step} />
                  </span>
                </div>
                <h2 className="text-xl font-semibold text-muted-foreground sm:text-3xl">{step.title}</h2>
                <div className="flex items-start gap-3">
                  <DialogPrimitive.Description
                    lang={plan.language}
                    className="min-w-0 flex-1 font-heading text-[2rem] leading-[1.2] font-medium sm:text-5xl"
                    data-testid="live-prompt"
                  >
                    {step.prompt}
                  </DialogPrimitive.Description>
                  {step.prompt && (
                    <ListenButton text={step.prompt} promptLang={plan.language} caregiverLang={plan.caregiverLanguage} size="lg" />
                  )}
                </div>
                {showTranslation && hasTranslation && (
                  <p lang={plan.caregiverLanguage} className="text-xl text-muted-foreground sm:text-2xl" data-testid="live-translation">
                    {step.promptTranslation}
                  </p>
                )}
                {step.followUps.length > 0 && (
                  <ul className="flex flex-col gap-2 text-xl" lang={plan.language} aria-label={ts.followUps}>
                    {step.followUps.map((f) => (
                      <li key={f} className="flex items-start gap-2 before:mt-1 before:text-primary before:content-['›']">
                        <span className="min-w-0 flex-1">{f}</span>
                        <ListenButton text={f} promptLang={plan.language} caregiverLang={plan.caregiverLanguage} />
                      </li>
                    ))}
                  </ul>
                )}
                {step.caregiverTip && (
                  <p className="flex gap-3 rounded-2xl bg-ochre-soft/60 px-4 py-3 text-lg" lang={plan.caregiverLanguage}>
                    <LightbulbIcon className="mt-1 size-5 shrink-0 text-ochre-ink" aria-hidden />
                    {step.caregiverTip}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Bottom bar: timer, reactions, navigation */}
          <div className="border-t border-border bg-card px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-lift sm:px-8">
            <div className="mx-auto flex w-full max-w-5xl flex-col gap-3">
              {(view.replanning || replanPhase?.status === "started") && (
                <p className="flex items-center gap-2 rounded-2xl bg-ochre-soft px-4 py-2 font-semibold text-ochre-ink" role="status">
                  <LoaderCircleIcon className="size-5 animate-spin motion-reduce:animate-none" aria-hidden />
                  {replanPhase?.message ?? t.adapting}
                </p>
              )}
              {!view.replanning && notice && (
                <p
                  className={cn(
                    "flex animate-rise items-center gap-2 rounded-2xl px-4 py-2 font-semibold",
                    notice.tone === "adapted" && "bg-ochre-soft text-ochre-ink",
                    notice.tone === "unchanged" && "bg-sage-soft text-sage-ink",
                    notice.tone === "failed" && "bg-rose-soft text-rose-ink",
                  )}
                  role="status"
                  data-testid="live-notice"
                >
                  <WandSparklesIcon className="size-5 shrink-0" aria-hidden />
                  {notice.text}
                </p>
              )}
              <fieldset className="flex flex-col gap-2" disabled={view.replanning}>
                <legend className="mb-1 text-[0.95rem] font-semibold text-muted-foreground">{t.howDidItGo}</legend>
                <div className="grid grid-cols-3 gap-2">
                  {REACTIONS.map(({ value, icon: RIcon, tone, pulse }) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={reaction === value}
                      data-selected={reaction === value}
                      data-testid={`react-${value}`}
                      onClick={(e) => {
                        // Blur so Space falls through to the timer handler on the dialog.
                        e.currentTarget.blur();
                        setTapped((prev) => ({
                          reaction: value,
                          stepId: step.id,
                          tapKey: prev && prev.reaction === value && prev.stepId === step.id ? prev.tapKey + 1 : 1,
                        }));
                        onReact(step.id, value);
                      }}
                      className={cn(
                        "flex min-h-[5.5rem] min-w-[7rem] cursor-pointer flex-col items-center justify-center gap-1 rounded-[1.375rem] border-2 border-border bg-background px-3 py-2 text-[0.95rem] leading-tight font-semibold transition-transform duration-150 hover:border-input active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none motion-reduce:active:scale-100 sm:min-h-24 sm:text-lg",
                        tone,
                        tapped && tapped.reaction === value && tapped.stepId === step.id && pulse,
                      )}
                    >
                      <RIcon className="size-6 shrink-0" aria-hidden />
                      <span>{t.reactions[value]}</span>
                      <span className="text-[0.8rem] font-normal max-sm:sr-only">{t.reactionHints[value]}</span>
                    </button>
                  ))}
                </div>
              </fieldset>
              <div className="flex items-center gap-2 sm:gap-3">
                <Button variant="outline" size="lg" className="px-4 sm:px-6" onClick={() => go(i - 1)} disabled={i === 0} data-icon="inline-start">
                  <ChevronLeftIcon aria-hidden />
                  <span className="hidden sm:inline">{t.prev}</span>
                  <span className="sr-only sm:hidden">{t.prev}</span>
                </Button>
                <div className="flex flex-1 items-center justify-center gap-2" role="group" aria-label={t.timer}>
                  <TimerRing progress={progress} />
                  <span className={cn("font-heading text-2xl tabular-nums", timer.left === 0 && "text-sage")} aria-live="off" data-testid="live-timer">
                    {formatTime(timer.left)}
                  </span>
                  <Button variant="secondary" size="icon" onClick={timer.toggle} aria-label={timer.running ? t.pause : t.start} disabled={timer.left === 0}>
                    {timer.running ? <PauseIcon aria-hidden /> : <PlayIcon aria-hidden />}
                  </Button>
                  <Button variant="ghost" size="icon-sm" onClick={timer.reset} aria-label={t.reset} className="hidden sm:inline-flex">
                    <RotateCcwIcon aria-hidden />
                  </Button>
                </div>
                {last ? (
                  <Button size="lg" onClick={() => setClosingManual(true)} data-testid="live-finish">
                    {t.finish}
                  </Button>
                ) : (
                  <Button size="lg" className="px-4 sm:px-6" onClick={() => go(i + 1)} data-icon="inline-end" data-testid="live-next">
                    <span className="hidden sm:inline">{t.next}</span>
                    <span className="sr-only sm:hidden">{t.next}</span>
                    <ChevronRightIcon aria-hidden />
                  </Button>
                )}
              </div>
              {timer.left === 0 && <p className="text-center text-sage" role="status">{t.timeUp}</p>}
              {next && (
                <p
                  key={`${next.id}:${plan.meta.revision}`}
                  className="animate-rise truncate text-center text-[0.95rem] text-muted-foreground"
                  data-testid="live-up-next"
                >
                  {t.upNext}: <span className="font-semibold text-foreground">{next.title}</span>
                  {view.changedStepIds.includes(next.id) && <Badge variant="ochre" className="ml-2">{ts.changed}</Badge>}
                </p>
              )}
              <p className="sr-only">{t.keyboard}</p>
            </div>
          </div>
          {showClosing && (
            <div
              className="absolute inset-0 z-10 flex animate-in flex-col items-center justify-center gap-6 bg-background/95 px-6 py-10 text-center fade-in-0 backdrop-blur-sm"
              role="dialog"
              aria-modal="true"
              aria-label={t.done}
              data-testid="live-closing"
            >
              <HeartHandshakeIcon className="size-16 text-sage" aria-hidden />
              <p className="font-heading max-w-xl text-3xl leading-[1.2] font-medium text-foreground sm:text-5xl">
                {t.done}
              </p>
              <div className="flex flex-wrap items-center justify-center gap-3">
                <DialogPrimitive.Close render={<Button size="lg" variant="secondary" data-testid="live-closing-finish" />}>
                  {t.doneAction}
                </DialogPrimitive.Close>
                <Button size="lg" render={<Link href="/" data-testid="live-closing-plan-another" />}>
                  {t.planAnother}
                </Button>
              </div>
            </div>
          )}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function TimerRing({ progress }: { progress: number }) {
  const r = 16;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 40 40" className="size-10 -rotate-90" aria-hidden>
      <circle cx="20" cy="20" r={r} fill="none" stroke="var(--border)" strokeWidth="4" />
      <circle
        cx="20"
        cy="20"
        r={r}
        fill="none"
        stroke="var(--primary)"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - progress)}
        className="transition-[stroke-dashoffset] duration-[250ms] ease-linear"
      />
    </svg>
  );
}
