"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CloudRainIcon,
  LanguagesIcon,
  LightbulbIcon,
  LoaderCircleIcon,
  MehIcon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
  SunIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type KeyboardEvent } from "react";
import { STEP_ICON } from "@/components/session/icons";
import { ProvenanceBadge, StepMedia } from "@/components/session/step-card";
import type { SessionView } from "@/components/session/view-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getMessages } from "@/i18n";
import type { Reaction, SessionPlan } from "@/lib/domain/types";
import { cn } from "@/lib/utils";

const REACTIONS: { value: Reaction; icon: LucideIcon; tone: string }[] = [
  { value: "lit_up", icon: SunIcon, tone: "data-[selected=true]:bg-ochre-soft data-[selected=true]:border-ochre data-[selected=true]:text-ochre-ink" },
  { value: "neutral", icon: MehIcon, tone: "data-[selected=true]:bg-clay-soft data-[selected=true]:border-clay-ink data-[selected=true]:text-clay-ink" },
  { value: "upset", icon: CloudRainIcon, tone: "data-[selected=true]:bg-rose-soft data-[selected=true]:border-rose data-[selected=true]:text-rose-ink" },
];

function formatTime(seconds: number) {
  const s = Math.max(0, seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Countdown for the current step. Restarts (paused) whenever `resetKey` changes. */
function useStepTimer(totalSeconds: number, resetKey: string) {
  const [state, setState] = useState({ key: resetKey, left: totalSeconds, running: false });
  // Reset during render when the step changes (no effect needed).
  if (state.key !== resetKey) setState({ key: resetKey, left: totalSeconds, running: false });
  useEffect(() => {
    if (!state.running) return;
    const id = setInterval(() => {
      setState((s) => (s.left <= 1 ? { ...s, left: 0, running: false } : { ...s, left: s.left - 1 }));
    }, 1000);
    return () => clearInterval(id);
  }, [state.running]);
  return {
    left: state.left,
    running: state.running,
    toggle: () => setState((s) => ({ ...s, running: s.left > 0 ? !s.running : false })),
    reset: () => setState((s) => ({ ...s, left: totalSeconds, running: false })),
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
  const t = getMessages().live;
  const ts = getMessages().step;
  const [showTranslation, setShowTranslation] = useState(true);
  const steps = plan.steps;
  const i = Math.min(index, steps.length - 1);
  const step = steps[i];
  const next = steps[i + 1];
  const total = step.durationMin * 60;
  const timer = useStepTimer(total, `${step.id}:${plan.meta.revision}`);
  const Icon = STEP_ICON[step.kind];
  const reaction = reactions[step.id];
  const replanPhase = view.phases.at(-1)?.phase === "replan" ? view.phases.at(-1) : undefined;
  const last = i === steps.length - 1;

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, select")) return;
    if (event.key === "ArrowRight" && !last) onIndexChange(i + 1);
    else if (event.key === "ArrowLeft" && i > 0) onIndexChange(i - 1);
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
            {step.promptTranslation && (
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
          <div className="flex-1 overflow-y-auto">
            <div
              key={`${step.id}:${plan.meta.revision}`}
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
                <DialogPrimitive.Description
                  lang={plan.language}
                  className="font-heading text-[2rem] leading-[1.2] font-medium sm:text-5xl"
                  style={{ fontVariationSettings: '"SOFT" 100, "opsz" 72' }}
                  data-testid="live-prompt"
                >
                  {step.prompt}
                </DialogPrimitive.Description>
                {showTranslation && step.promptTranslation && (
                  <p lang={plan.caregiverLanguage} className="text-xl text-muted-foreground sm:text-2xl" data-testid="live-translation">
                    {step.promptTranslation}
                  </p>
                )}
                {step.followUps.length > 0 && (
                  <ul className="flex flex-col gap-2 text-xl" lang={plan.language} aria-label={ts.followUps}>
                    {step.followUps.map((f) => (
                      <li key={f} className="before:mr-2 before:text-primary before:content-['›']">
                        {f}
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
                {last && <p className="text-lg font-semibold text-sage">{t.done}</p>}
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
              <fieldset className="flex flex-col gap-2" disabled={view.replanning}>
                <legend className="mb-1 text-[0.95rem] font-semibold text-muted-foreground">{t.howDidItGo}</legend>
                <div className="grid grid-cols-3 gap-2">
                  {REACTIONS.map(({ value, icon: RIcon, tone }) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={reaction === value}
                      data-selected={reaction === value}
                      data-testid={`react-${value}`}
                      onClick={() => onReact(step.id, value)}
                      className={cn(
                        "flex min-h-14 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-2xl border-2 border-border bg-background px-2 py-1.5 text-[0.95rem] leading-tight font-semibold sm:min-h-16 transition-colors hover:border-input disabled:cursor-not-allowed disabled:opacity-60 sm:flex-row sm:gap-2 sm:text-lg",
                        tone,
                      )}
                    >
                      <RIcon className="size-6 shrink-0" aria-hidden />
                      {t.reactions[value]}
                    </button>
                  ))}
                </div>
              </fieldset>
              <div className="flex items-center gap-2 sm:gap-3">
                <Button variant="outline" size="lg" className="px-4 sm:px-6" onClick={() => onIndexChange(i - 1)} disabled={i === 0} data-icon="inline-start">
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
                  <DialogPrimitive.Close render={<Button size="lg" />}>{t.finish}</DialogPrimitive.Close>
                ) : (
                  <Button size="lg" className="px-4 sm:px-6" onClick={() => onIndexChange(i + 1)} data-icon="inline-end" data-testid="live-next">
                    <span className="hidden sm:inline">{t.next}</span>
                    <span className="sr-only sm:hidden">{t.next}</span>
                    <ChevronRightIcon aria-hidden />
                  </Button>
                )}
              </div>
              {timer.left === 0 && <p className="text-center text-sage" role="status">{t.timeUp}</p>}
              {next && (
                <p className="truncate text-center text-[0.95rem] text-muted-foreground" data-testid="live-up-next">
                  {t.upNext}: <span className="font-semibold text-foreground">{next.title}</span>
                  {view.changedStepIds.includes(next.id) && <Badge variant="ochre" className="ml-2">{ts.changed}</Badge>}
                </p>
              )}
              <p className="sr-only">{t.keyboard}</p>
            </div>
          </div>
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
        className="transition-[stroke-dashoffset] duration-1000 ease-linear"
      />
    </svg>
  );
}
