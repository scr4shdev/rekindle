"use client";

import { ArrowLeftIcon, BotIcon, PlayIcon, PrinterIcon, RotateCcwIcon, ScaleIcon, SquareIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { LiveSession } from "@/components/session/live-session";
import { PlanTimeline } from "@/components/session/plan-timeline";
import { ReasoningTrace } from "@/components/session/reasoning-trace";
import { RECORDED_PERSONA, resolveRequest } from "@/components/session/session-request";
import { parseSourceParam, resolveSource, type SourceKind } from "@/components/session/source";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAgentStream } from "@/hooks/use-agent-stream";
import { MessagesProvider, useMessages } from "@/i18n/provider";
import type { Anchors, Reaction, ReactionRecord, SessionMode } from "@/lib/domain/types";
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

/**
 * Place + era + session-language hero band. Visible from first paint (fed from
 * the request's person info) so a judge is not staring at an empty header while
 * the agent streams; once PARSE lands, anchors refine place and years. Pure
 * typography and a soft gradient — dark-mode safe, reduced-motion safe.
 */
function EraHero({
  persona,
  anchors,
  birthPlace,
  birthYear,
  sessionLanguage,
  streaming,
}: {
  persona: string;
  anchors: Anchors | undefined;
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
    </section>
  );
}

export function SessionView() {
  const params = useSearchParams();
  const personaParam = params.get("persona");
  const modeParam = params.get("mode");
  const sourceParam = parseSourceParam(params.get("source"));
  const speed = Number(params.get("speed") ?? "1") || 1;

  // Resolved once per URL: custom input is read from memory at that moment.
  const resolved = useMemo(() => resolveRequest(personaParam, modeParam), [personaParam, modeParam]);
  const hasRecording = resolved.ok && resolved.hasRecording;
  // Chrome follows the person: Maria -> Italian, Fatima -> French. The caregiver
  // route (landing, compare, error pages) stays English.
  const sessionLanguage = resolved.ok ? (resolved.request.person.sessionLanguage ?? "en") : "en";
  const source = useMemo(
    () => resolveSource(sourceParam, { speed, hasRecording, language: sessionLanguage }),
    [sourceParam, speed, hasRecording, sessionLanguage],
  );
  const { view, servedBy, start, replan, cancel } = useAgentStream(source, sessionLanguage);
  const [runId, setRunId] = useState(0);
  const [liveOpen, setLiveOpen] = useState(false);
  const [liveIndex, setLiveIndex] = useState(0);
  const [reactions, setReactions] = useState<Record<string, Reaction>>({});

  const [history, setHistory] = useState<ReactionRecord[]>([]);

  function react(stepId: string, reaction: Reaction) {
    if (reactions[stepId] === reaction || view.replanning) return;
    setReactions((r) => ({ ...r, [stepId]: reaction }));
    setHistory((h) => [...h, { stepId, reaction }]);
    const plan = view.plan;
    const isLast = plan?.steps.at(-1)?.id === stepId;
    if (!plan || !view.anchors || isLast) return;
    // One record per step (latest reaction wins), oldest first, excluding the step being reacted to.
    const latest = new Map<string, ReactionRecord>();
    for (const record of history) {
      latest.delete(record.stepId);
      latest.set(record.stepId, record);
    }
    latest.delete(stepId);
    replan({ plan, anchors: view.anchors, stepId, reaction, history: [...latest.values()] });
  }


  useEffect(() => {
    if (resolved.ok) start(resolved.request);
  }, [resolved, start, runId]);

  if (!resolved.ok) {
    return <SessionResolveError reason={resolved.reason} />;
  }

  return (
    <MessagesProvider language={sessionLanguage}>
      <SessionViewBody
        resolved={resolved}
        view={view}
        servedBy={servedBy}
        liveOpen={liveOpen}
        setLiveOpen={setLiveOpen}
        liveIndex={liveIndex}
        setLiveIndex={setLiveIndex}
        reactions={reactions}
        onReact={react}
        onRetry={() => setRunId((n) => n + 1)}
        onCancel={cancel}
      />
    </MessagesProvider>
  );
}

type ResolvedOk = Extract<ReturnType<typeof resolveRequest>, { ok: true }>;

function SessionResolveError({ reason }: { reason: string }) {
  const t = useMessages().session;
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-start gap-5 rounded-3xl border border-border bg-card p-8 shadow-paper" role="alert" data-testid="session-alert">
      <p className="text-xl">{reason === "missing-custom" ? t.missingCustom : t.unknownPersona}</p>
      <div className="flex flex-wrap gap-3">
        <Link href="/#custom" className={buttonVariants({ size: "lg" })}>
          {t.missingCustomAction}
        </Link>
        <Link href={`/session?persona=${RECORDED_PERSONA}`} className={buttonVariants({ size: "lg", variant: "outline" })}>
          {t.tryMaria}
        </Link>
      </div>
    </div>
  );
}

function SessionViewBody({
  resolved,
  view,
  servedBy,
  liveOpen,
  setLiveOpen,
  liveIndex,
  setLiveIndex,
  reactions,
  onReact,
  onRetry,
  onCancel,
}: {
  resolved: ResolvedOk;
  view: ReturnType<typeof useAgentStream>["view"];
  servedBy: ReturnType<typeof useAgentStream>["servedBy"];
  liveOpen: boolean;
  setLiveOpen: (open: boolean) => void;
  liveIndex: number;
  setLiveIndex: (n: number) => void;
  reactions: Record<string, Reaction>;
  onReact: (stepId: string, reaction: Reaction) => void;
  onRetry: () => void;
  onCancel: () => void;
}) {
  const t = useMessages().session;
  const hasRecording = resolved.hasRecording;
  const mode: SessionMode = resolved.request.mode ?? "grounded";
  const plan = view.plan;
  const streaming = view.status === "streaming";
  const anchors = view.anchors;
  const name = resolved.name ?? t.someone;
  const comparePersona = resolved.persona;
  // While the agent is still thinking and nothing is composed yet, the trace gets the full width.
  const traceWide = view.status === "streaming" && view.steps.length === 0;

  return (
    <div className="flex flex-col gap-6" data-testid="session-view" data-status={view.status}>
      <header className="flex flex-col gap-4 print:hidden">
        <Link href="/" className="inline-flex w-fit items-center gap-2 rounded-full font-semibold text-muted-foreground hover:text-foreground">
          <ArrowLeftIcon className="size-5" aria-hidden />
          {t.back}
        </Link>
        <EraHero
          persona={resolved.persona}
          anchors={anchors}
          birthPlace={resolved.request.person.birthPlace}
          birthYear={resolved.request.person.birthYear}
          sessionLanguage={resolved.request.person.sessionLanguage ?? "en"}
          streaming={streaming}
        />
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-col gap-2">
            <h1 className="text-3xl leading-tight font-semibold sm:text-5xl" data-testid="session-title" lang={plan?.language}>
              {plan?.title ?? (name === t.someone ? t.planningGeneric : t.planningFor(name))}
            </h1>
            {streaming && view.steps.length === 0 && (
              <p className="text-muted-foreground" data-testid="wait-hint">
                {t.waitHint}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {mode === "grounded" ? (
                <Badge variant="sage">{t.modeGrounded}</Badge>
              ) : (
                <Badge variant="outline">
                  <BotIcon aria-hidden />
                  {t.modeLlmOnly}
                </Badge>
              )}
              {servedBy && <SourceBadge kind={servedBy} />}
              {plan && plan.meta.qlooMode !== "unused" && (
                <Tooltip>
                  <TooltipTrigger render={<Badge variant={plan.meta.qlooMode === "live" ? "sage" : "outline"} className="cursor-help" />} data-testid="qloo-mode">
                    {plan.meta.qlooMode === "live" ? t.qlooLive : t.qlooMock}
                    <span className="sr-only">: {plan.meta.qlooMode === "live" ? t.qlooLiveHint : t.qlooMockHint}</span>
                  </TooltipTrigger>
                  <TooltipContent>{plan.meta.qlooMode === "live" ? t.qlooLiveHint : t.qlooMockHint}</TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2.5">
            {streaming && (
              <Button variant="outline" onClick={onCancel} data-icon="inline-start">
                <SquareIcon aria-hidden />
                {t.cancel}
              </Button>
            )}
            {(view.status === "error" || view.status === "cancelled") && (
              <Button onClick={onRetry} data-icon="inline-start">
                <RotateCcwIcon aria-hidden />
                {t.retry}
              </Button>
            )}
            {plan && (
              <>
                <Button
                  size="lg"
                  className="flex-1 sm:flex-none"
                  data-icon="inline-start"
                  data-testid="start-live"
                  onClick={() => setLiveOpen(true)}
                >
                  <PlayIcon aria-hidden />
                  {t.start}
                </Button>
                <Button variant="outline" size="icon-lg" onClick={() => window.print()} aria-label={t.print} title={t.print}>
                  <PrinterIcon aria-hidden />
                </Button>
              </>
            )}
            {!streaming && (
              <Link
                href={`/compare?persona=${comparePersona}`}
                className={cn(buttonVariants({ variant: "outline", size: plan ? "lg" : "default" }), "h-auto min-h-12 shrink px-3 py-2 whitespace-normal sm:px-6")}
                data-icon="inline-start"
              >
                <ScaleIcon aria-hidden />
                {t.compare}
              </Link>
            )}
          </div>
        </div>
        {view.failure && (
          <div role="alert" data-testid="session-alert" className="flex flex-col gap-3 rounded-2xl bg-rose-soft px-5 py-4 text-rose-ink sm:flex-row sm:items-center">
            <TriangleAlertIcon className="size-6 shrink-0" aria-hidden />
            <p className="flex-1 font-semibold">{view.failure.message}</p>
            {!hasRecording && (
              <Link href={`/session?persona=${RECORDED_PERSONA}`} className={buttonVariants({ variant: "outline" })}>
                {t.tryMaria}
              </Link>
            )}
          </div>
        )}
        {view.status === "cancelled" && <p className="text-muted-foreground">{t.stopped}</p>}
        {view.warnings.length > 0 && plan && !view.failure && (
          <p className="rounded-2xl bg-ochre-soft px-5 py-3 text-ochre-ink">{t.degraded}</p>
        )}
      </header>

      <div className={cn("grid items-start gap-6 print:block", !traceWide && "lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]")}>
        <ReasoningTrace
          view={view}
          className="max-h-[60dvh] print:hidden lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)]"
          onRetry={onRetry}
        />
        {!traceWide && (
          <PlanTimeline
            className="animate-in duration-500 fade-in slide-in-from-right-8 motion-reduce:animate-none"
            view={view}
            language={resolved.request.person.sessionLanguage ?? "en"}
            caregiverLanguage={resolved.request.person.caregiverLanguage ?? "en"}
          />
        )}
      </div>
      {plan && (
        <LiveSession
          open={liveOpen}
          onOpenChange={setLiveOpen}
          view={view}
          plan={plan}
          index={liveIndex}
          onIndexChange={setLiveIndex}
          reactions={reactions}
          onReact={onReact}
        />
      )}
    </div>
  );
}

function SourceBadge({ kind }: { kind: SourceKind }) {
  const t = useMessages().session;
  return (
    <Tooltip>
      <TooltipTrigger render={<Badge variant="outline" className="cursor-help" />}>
        {kind === "sample" ? t.sourceSample : t.sourceLive}
        <span className="sr-only">: {kind === "sample" ? t.sourceSampleHint : t.sourceLiveHint}</span>
      </TooltipTrigger>
      <TooltipContent>{kind === "sample" ? t.sourceSampleHint : t.sourceLiveHint}</TooltipContent>
    </Tooltip>
  );
}
