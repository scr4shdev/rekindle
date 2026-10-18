"use client";

import { ArrowLeftIcon, PlayIcon, PrinterIcon, RotateCcwIcon, ScaleIcon, SquareIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { PlanTimeline } from "@/components/session/plan-timeline";
import { ReasoningTrace } from "@/components/session/reasoning-trace";
import { RECORDED_PERSONA, resolveRequest } from "@/components/session/session-request";
import { parseSourceParam, resolveSource, type SourceKind } from "@/components/session/source";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAgentStream } from "@/hooks/use-agent-stream";
import { getMessages } from "@/i18n";
import type { Anchors, SessionMode } from "@/lib/domain/types";
import { cn } from "@/lib/utils";

function languageNames(anchors: Anchors): string {
  return anchors.languages.map((l) => l.name).join(", ");
}

export function SessionView() {
  const params = useSearchParams();
  const t = getMessages().session;
  const personaParam = params.get("persona");
  const modeParam = params.get("mode");
  const sourceParam = parseSourceParam(params.get("source"));
  const speed = Number(params.get("speed") ?? "1") || 1;

  // Resolved once per URL: custom input is read from memory at that moment.
  const resolved = useMemo(() => resolveRequest(personaParam, modeParam), [personaParam, modeParam]);
  const hasRecording = resolved.ok && resolved.hasRecording;
  const source = useMemo(() => resolveSource(sourceParam, { speed, hasRecording }), [sourceParam, speed, hasRecording]);
  const { view, servedBy, start, cancel } = useAgentStream(source);
  const [runId, setRunId] = useState(0);

  useEffect(() => {
    if (resolved.ok) start(resolved.request);
  }, [resolved, start, runId]);

  if (!resolved.ok) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-start gap-5 rounded-3xl border border-border bg-card p-8 shadow-paper" role="alert">
        <p className="text-xl">{resolved.reason === "missing-custom" ? t.missingCustom : t.unknownPersona}</p>
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

  const mode: SessionMode = resolved.request.mode ?? "grounded";
  const plan = view.plan;
  const streaming = view.status === "streaming";
  const anchors = view.anchors;
  const name = resolved.name ?? t.someone;
  const comparePersona = resolved.persona;

  return (
    <div className="flex flex-col gap-6" data-testid="session-view" data-status={view.status}>
      <header className="flex flex-col gap-4 print:hidden">
        <Link href="/" className="inline-flex w-fit items-center gap-2 rounded-full font-semibold text-muted-foreground hover:text-foreground">
          <ArrowLeftIcon className="size-5" aria-hidden />
          {t.back}
        </Link>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-col gap-2">
            <h1 className="text-3xl leading-tight font-semibold sm:text-5xl" data-testid="session-title">
              {plan?.title ?? t.planningFor(name)}
            </h1>
            <div className="flex flex-wrap items-center gap-2">
              {anchors && (
                <span className="mr-1 text-lg text-muted-foreground">
                  {anchors.places[0]?.name} · {t.era(anchors.formativeWindow.startYear, anchors.formativeWindow.endYear)} ·{" "}
                  {languageNames(anchors)}
                </span>
              )}
              <Badge variant={mode === "grounded" ? "sage" : "clay"}>{mode === "grounded" ? t.modeGrounded : t.modeLlmOnly}</Badge>
              {servedBy && <SourceBadge kind={servedBy} />}
            </div>
          </div>
          <div className="flex flex-wrap gap-2.5">
            {streaming && (
              <Button variant="outline" onClick={cancel} data-icon="inline-start">
                <SquareIcon aria-hidden />
                {t.cancel}
              </Button>
            )}
            {(view.status === "error" || view.status === "cancelled") && (
              <Button onClick={() => setRunId((n) => n + 1)} data-icon="inline-start">
                <RotateCcwIcon aria-hidden />
                {t.retry}
              </Button>
            )}
            {plan && (
              <>
                <Button size="lg" data-icon="inline-start" data-testid="start-live">
                  <PlayIcon aria-hidden />
                  {t.start}
                </Button>
                <Button variant="outline" size="lg" onClick={() => window.print()} data-icon="inline-start">
                  <PrinterIcon aria-hidden />
                  {t.print}
                </Button>
              </>
            )}
            {!streaming && (
              <Link
                href={`/compare?persona=${comparePersona}`}
                className={buttonVariants({ variant: "ghost", size: plan ? "lg" : "default" })}
                data-icon="inline-start"
              >
                <ScaleIcon aria-hidden />
                {t.compare}
              </Link>
            )}
          </div>
        </div>
        {view.failure && (
          <div role="alert" className="flex flex-col gap-3 rounded-2xl bg-rose-soft px-5 py-4 text-rose-ink sm:flex-row sm:items-center">
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

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <ReasoningTrace view={view} className="print:hidden lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)]" />
        <PlanTimeline view={view} />
      </div>
    </div>
  );
}

function SourceBadge({ kind }: { kind: SourceKind }) {
  const t = getMessages().session;
  return (
    <Tooltip>
      <TooltipTrigger render={<Badge variant="outline" className={cn("cursor-help")} tabIndex={0} />}>
        {kind === "sample" ? t.sourceSample : t.sourceLive}
      </TooltipTrigger>
      <TooltipContent>{kind === "sample" ? t.sourceSampleHint : t.sourceLiveHint}</TooltipContent>
    </Tooltip>
  );
}
