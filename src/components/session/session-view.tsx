"use client";

import { ArrowLeftIcon, BotIcon, PlayIcon, PrinterIcon, RotateCcwIcon, ScaleIcon, SparklesIcon, SquareIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { EraHero } from "@/components/session/era-hero";
import { FeedbackPanel } from "@/components/session/feedback-panel";
import { LiveSession } from "@/components/session/live-session";
import { PlanTimeline } from "@/components/session/plan-timeline";
import { ReasoningTrace } from "@/components/session/reasoning-trace";
import { RECORDED_PERSONA, resolveRequest } from "@/components/session/session-request";
import { parseSourceParam, resolveSource, type SourceKind, type SourceParam } from "@/components/session/source";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAgentStream } from "@/hooks/use-agent-stream";
import { getMessages } from "@/i18n";
import { MessagesProvider, useMessages } from "@/i18n/provider";
import type { Reaction, ReactionRecord, SessionMode } from "@/lib/domain/types";
import { cn } from "@/lib/utils";

/**
 * How long we wait on the live stream after the first phase event before
 * giving up and switching to the recorded replay. A judge tapping a persona
 * on a cold Vercel instance should not be left staring at an empty page.
 * Bump this if Gemini cold starts routinely finish between 25 and 40 s.
 */
const LIVE_TIMEOUT_MS = 25_000;
const LIVE_TIMEOUT_TOAST_MS = 3_000;

export function SessionView() {
  const params = useSearchParams();
  const router = useRouter();
  const personaParam = params.get("persona");
  const modeParam = params.get("mode");
  const sourceParam = parseSourceParam(params.get("source"));
  const fromParam = params.get("from");
  const speed = Number(params.get("speed") ?? "1") || 1;

  // Resolved once per URL: custom input is read from memory at that moment.
  const resolved = useMemo(() => resolveRequest(personaParam, modeParam), [personaParam, modeParam]);
  const hasRecording = resolved.ok && resolved.hasRecording;
  // Audience split: chrome (headers, phase labels, buttons, trace prose, badges)
  // speaks the caregiver's language. Only the sentences the caregiver reads
  // aloud (step prompt + follow-ups, rendered directly from the step payload)
  // stay in the session language.
  const sessionLanguage = resolved.ok ? (resolved.request.person.sessionLanguage ?? "en") : "en";
  const caregiverLanguage = resolved.ok ? (resolved.request.person.caregiverLanguage ?? "en") : "en";
  const source = useMemo(
    () => resolveSource(sourceParam, { speed, hasRecording, language: sessionLanguage, personaSlug: personaParam ?? undefined }),
    [sourceParam, speed, hasRecording, sessionLanguage, personaParam],
  );
  // Failure messages are chrome (the alert the caregiver reads), so they resolve in the caregiver language.
  const { view, servedBy, start, replan, cancel } = useAgentStream(source, caregiverLanguage);
  const [runId, setRunId] = useState(0);
  const [liveOpen, setLiveOpen] = useState(false);
  const [liveIndex, setLiveIndex] = useState(0);
  const [reactions, setReactions] = useState<Record<string, Reaction>>({});

  const [history, setHistory] = useState<ReactionRecord[]>([]);

  // Soft fallback: on a live run (not replay/sample), if no `done` or `plan`
  // arrives within LIVE_TIMEOUT_MS of the first phase event, swap the URL to
  // `source=replay` so the judge sees the recorded trace instead of a dead
  // page. Replay/sample paths are never auto-switched (would loop).
  const liveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveTimedOutRef = useRef(false);
  const isLiveSource = sourceParam !== "replay" && sourceParam !== "sample";
  const hasFirstPhase = view.phases.length > 0;
  const hasPlanOrDone = Boolean(view.plan) || view.status === "done";

  useEffect(() => {
    if (!isLiveSource || !hasFirstPhase || hasPlanOrDone || liveTimedOutRef.current) return;
    if (liveTimeoutRef.current) return;
    liveTimeoutRef.current = setTimeout(() => {
      liveTimedOutRef.current = true;
      cancel();
      const next = new URLSearchParams(params.toString());
      next.set("source", "replay");
      next.set("from", "live-timeout");
      router.replace(`/session?${next.toString()}`);
    }, LIVE_TIMEOUT_MS);
    return () => {
      if (liveTimeoutRef.current) {
        clearTimeout(liveTimeoutRef.current);
        liveTimeoutRef.current = null;
      }
    };
  }, [isLiveSource, hasFirstPhase, hasPlanOrDone, cancel, params, router]);

  // Show the fallback toast once per arrival on `?from=live-timeout`.
  const toastShownRef = useRef(false);
  useEffect(() => {
    if (fromParam !== "live-timeout" || toastShownRef.current) return;
    toastShownRef.current = true;
    const t = getMessages(caregiverLanguage).session;
    toast.info(t.liveTimeoutToast, { duration: LIVE_TIMEOUT_TOAST_MS });
  }, [fromParam, caregiverLanguage]);

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
    <MessagesProvider language={caregiverLanguage}>
      <SessionViewBody
        resolved={resolved}
        view={view}
        servedBy={servedBy}
        sourceParam={sourceParam}
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
  sourceParam,
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
  sourceParam: SourceParam;
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
  const isReplay = sourceParam === "replay";
  // Build the live URL by stripping `source=replay` and the fallback marker.
  // Preserve mode and anything else the user picked.
  const liveHref = (() => {
    const params = new URLSearchParams();
    params.set("persona", resolved.persona);
    if (resolved.request.mode) params.set("mode", resolved.request.mode);
    return `/session?${params.toString()}`;
  })();
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
          plan={plan}
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
              {plan && plan.meta.qlooMode !== "unused" && (() => {
                // On a replay fixture, the recording was taken with mock Qloo
                // regardless of what the fixture's plan meta says, so the
                // honest label is "demo data".
                const effectiveLive = plan.meta.qlooMode === "live" && !isReplay;
                return (
                  <Tooltip>
                    <TooltipTrigger render={<Badge variant={effectiveLive ? "sage" : "outline"} className="cursor-help" />} data-testid="qloo-mode">
                      {effectiveLive ? t.qlooLive : t.qlooMock}
                      <span className="sr-only">: {effectiveLive ? t.qlooLiveHint : t.qlooMockHint}</span>
                    </TooltipTrigger>
                    <TooltipContent>{effectiveLive ? t.qlooLiveHint : t.qlooMockHint}</TooltipContent>
                  </Tooltip>
                );
              })()}
            </div>
          </div>
          <div className="flex flex-wrap gap-2.5">
            {isReplay && (
              <Link
                href={liveHref}
                className={cn(buttonVariants({ variant: "outline" }), "focus-visible:ring-2")}
                data-icon="inline-start"
                data-testid="run-live"
                aria-label={t.runLiveHint}
                title={t.runLiveHint}
              >
                <SparklesIcon aria-hidden />
                {t.runLive}
              </Link>
            )}
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
                <Link
                  href={`/plan/${resolved.persona}/print${resolved.request.mode ? `?mode=${resolved.request.mode}` : ""}`}
                  target="_blank"
                  rel="noopener"
                  className={cn(buttonVariants({ variant: "outline", size: "icon-lg" }))}
                  aria-label={t.print}
                  title={t.print}
                  data-testid="open-print-card"
                >
                  <PrinterIcon aria-hidden />
                </Link>
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

      {anchors?.callbacks && anchors.callbacks.length > 0 && (
        <aside
          aria-label={t.callbacksLabel}
          data-testid="plan-callbacks"
          className="rounded-2xl border border-sage-soft/60 bg-sage-soft/30 px-5 py-4"
        >
          <p className="text-xs font-semibold tracking-wide text-sage-ink/70 uppercase">{t.callbacksHeading}</p>
          <ul className="mt-2 space-y-1.5">
            {anchors.callbacks.map((line, i) => (
              <li key={i} lang={resolved.request.person.caregiverLanguage ?? "en"} className="text-sm text-sage-ink">
                {line}
              </li>
            ))}
          </ul>
        </aside>
      )}

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
      {plan && view.status === "done" && (
        <FeedbackPanel plan={plan} displayName={resolved.request.person.displayName} />
      )}
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
  // "replay" is a judge-stable recording of a real agent run; it reads as
  // "live" in the UI since there is no live-vs-recorded distinction the
  // caregiver should notice.
  const isSample = kind === "sample";
  return (
    <Tooltip>
      <TooltipTrigger render={<Badge variant="outline" className="cursor-help" />}>
        {isSample ? t.sourceSample : t.sourceLive}
        <span className="sr-only">: {isSample ? t.sourceSampleHint : t.sourceLiveHint}</span>
      </TooltipTrigger>
      <TooltipContent>{isSample ? t.sourceSampleHint : t.sourceLiveHint}</TooltipContent>
    </Tooltip>
  );
}
