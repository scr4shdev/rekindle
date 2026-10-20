"use client";

import { ArrowLeftIcon, ArrowRightIcon, BotIcon, CircleSlashIcon, SearchCheckIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo } from "react";
import { wouldSlip } from "@/components/compare/would-slip";
import { STEP_ICON } from "@/components/session/icons";
import { RECORDED_PERSONA, resolveRequest } from "@/components/session/session-request";
import { qlooNotFoundLine } from "@/components/session/qloo-citation";
import { rejectionDisplay } from "@/components/session/rejection-display";
import { parseSourceParam, resolveSource } from "@/components/session/source";
import { ProvenanceBadge } from "@/components/session/step-card";
import { SESSION_PHASES, type SessionView } from "@/components/session/view-state";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { useAgentStream } from "@/hooks/use-agent-stream";
import { getMessages } from "@/i18n";
import type { RejectedItem, SessionRequestDraft } from "@/lib/domain/types";
import { cn } from "@/lib/utils";

export const CAUGHT_KINDS = new Set(["anachronism", "wrong_locale", "emotional_risk"]);

/** The one rejection set the hero, grid and glance all agree on: pre-plan catches whose kind is in CAUGHT_KINDS. */
export function caughtRejections(view: SessionView) {
  return view.rejected.filter((r) => r.phase !== "replan" && CAUGHT_KINDS.has(r.kind));
}

interface Metrics {
  verified: number;
  discoveries: number;
  caught: number;
  anchored: number;
  steps: number;
  images: number;
  calls: number;
}

/** Counts derived from structured events only (provenance, rejection kinds, image urls). */
function metrics(view: SessionView): Metrics {
  const entities = Object.values(view.entities);
  const steps = view.steps;
  return {
    verified: entities.filter((e) => e.provenance === "llm-proposed-qloo-verified").length,
    discoveries: entities.filter((e) => e.provenance === "qloo-affinity").length,
    caught: caughtRejections(view).length,
    anchored: steps.filter((s) => s.provenance === "qloo-grounded").length,
    steps: steps.length,
    images: steps.filter((s) => s.entity?.imageUrl || s.mediaUrl).length,
    calls: view.qlooCalls,
  };
}

export function CompareView() {
  const params = useSearchParams();
  const t = getMessages().compare;
  const ts = getMessages().session;
  const personaParam = params.get("persona");
  const sourceParam = parseSourceParam(params.get("source"));
  const speed = Number(params.get("speed") ?? "1") || 1;
  const resolved = useMemo(() => resolveRequest(personaParam, "grounded"), [personaParam]);
  const hasRecording = resolved.ok && resolved.hasRecording;
  const source = useMemo(() => resolveSource(sourceParam, { speed, hasRecording }), [sourceParam, speed, hasRecording]);
  const llm = useAgentStream(source);
  const grounded = useAgentStream(source);
  const startLlm = llm.start;
  const startGrounded = grounded.start;

  useEffect(() => {
    if (!resolved.ok) return;
    const person = resolved.request.person;
    const requests: [SessionRequestDraft, SessionRequestDraft] = [
      { mode: "llm-only", person },
      { mode: "grounded", person },
    ];
    startLlm(requests[0]);
    startGrounded(requests[1]);
  }, [resolved, startLlm, startGrounded]);

  if (!resolved.ok) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-start gap-5 rounded-3xl border border-border bg-card p-8 shadow-paper" role="alert" data-testid="session-alert">
        <p className="text-xl">{resolved.reason === "missing-custom" ? ts.missingCustom : ts.unknownPersona}</p>
        <Link href={`/compare?persona=${RECORDED_PERSONA}`} className={buttonVariants({ size: "lg" })}>
          {ts.tryMaria}
        </Link>
      </div>
    );
  }

  const name = resolved.name ?? ts.someone;
  const a = metrics(llm.view);
  const b = metrics(grounded.view);
  const groundedRejected = grounded.view.rejected.filter((r) => r.phase !== "replan");
  // Mobile "At a glance" strip and the hero stat and the grid caught row
  // all count the same list: pre-plan rejections whose kind lands in
  // CAUGHT_KINDS. The invariant is tested in compare-view.spec.ts.
  const groundedCaught = caughtRejections(grounded.view);
  const headlineReady = b.caught + b.verified > 0;
  const rows: { label: string; llm: string; grounded: string; win: boolean }[] = [
    { label: t.metrics.verified, llm: "", grounded: String(b.verified), win: b.verified > 0 },
    { label: t.metrics.discoveries, llm: String(a.discoveries), grounded: String(b.discoveries), win: b.discoveries > a.discoveries },
    { label: t.metrics.caught, llm: String(a.caught), grounded: String(b.caught), win: b.caught > a.caught },
    { label: t.metrics.anchored, llm: t.of(a.anchored, a.steps), grounded: t.of(b.anchored, b.steps), win: b.anchored > a.anchored },
    ...(a.images + b.images > 0 ? [{ label: t.metrics.images, llm: String(a.images), grounded: String(b.images), win: b.images > a.images }] : []),
  ];

  return (
    <div className="flex flex-col gap-8" data-testid="compare-view" data-llm-status={llm.view.status} data-grounded-status={grounded.view.status}>
      <header className="flex flex-col gap-3">
        <Link href="/" className="inline-flex w-fit items-center gap-2 rounded-full font-semibold text-muted-foreground hover:text-foreground">
          <ArrowLeftIcon className="size-5" aria-hidden />
          {ts.back}
        </Link>
        <p className="font-semibold text-primary">{t.eyebrow}</p>
        <h1 className="text-3xl leading-tight font-semibold sm:text-5xl">{t.title(name)}</h1>
        <p className="max-w-3xl text-lg text-muted-foreground">{t.lead}</p>
      </header>

      <aside
        aria-live="polite"
        className="rounded-3xl border border-border bg-card px-5 py-5 shadow-paper sm:px-8 sm:py-7"
        data-testid="compare-headline"
      >
        {headlineReady ? (
          <p className="font-heading text-3xl leading-tight sm:text-5xl">{t.headline(b.caught, b.verified)}</p>
        ) : (
          <p className="font-heading text-3xl leading-tight text-muted-foreground sm:text-5xl">{t.headlineWorking}</p>
        )}
      </aside>

      <section aria-labelledby="score-title" className="overflow-hidden rounded-3xl border border-border bg-card shadow-paper">
        <h2 id="score-title" className="border-b border-border bg-paper-deep px-5 py-4 text-xl font-semibold sm:px-6">
          {t.scoreTitle}
        </h2>
        <table className="w-full table-fixed text-left" data-testid="compare-score">
          <thead>
            <tr className="text-[0.95rem] text-muted-foreground">
              <th scope="col" className="w-[44%] px-4 py-3 font-semibold sm:w-1/2 sm:px-6">
                <span className="sr-only">{t.scoreTitle}</span>
              </th>
              <th scope="col" className="px-2 py-3 text-center text-sm leading-tight font-semibold sm:px-3 sm:text-base">
                <BotIcon className="mx-auto mb-1 size-5" aria-hidden />
                {t.llmOnly}
              </th>
              <th scope="col" className="px-2 py-3 text-center text-sm leading-tight font-semibold text-sage sm:px-3 sm:text-base">
                <SearchCheckIcon className="mx-auto mb-1 size-5" aria-hidden />
                {t.grounded}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-t border-border">
                <th scope="row" className="px-4 py-3 text-[0.95rem] leading-snug font-semibold sm:px-6 sm:text-base">
                  {row.label}
                </th>
                <td className="px-2 py-3 text-center font-heading text-lg text-muted-foreground tabular-nums sm:px-3 sm:text-2xl">
                  {row.llm || <span className="font-sans text-sm font-semibold sm:text-base">{t.unchecked}</span>}
                </td>
                <td className={cn("px-2 py-3 text-center font-heading text-lg tabular-nums sm:px-3 sm:text-2xl", row.win && "bg-sage-soft/60 font-semibold text-sage-ink")}>
                  {row.grounded}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="border-t border-border bg-paper-deep px-5 py-3 text-sm text-muted-foreground sm:px-6" data-testid="compare-calls-caption">
          {t.callsCaption(b.calls)}
        </p>
      </section>

      {groundedCaught.length > 0 && (
        <section
          aria-label={t.glanceTitle}
          className="flex flex-col gap-3 rounded-3xl border border-border bg-card p-5 shadow-paper lg:hidden"
          data-testid="compare-glance"
        >
          <h2 className="font-sans text-base font-bold">{t.glanceTitle}</h2>
          <ul className="flex flex-col gap-3">
            {groundedCaught.map((item) => {
              const display = rejectionDisplay(item);
              return (
                <li key={`glance-${item.label}-${item.kind}`} className="flex flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <CircleSlashIcon className="size-4 shrink-0 text-rose" aria-hidden />
                    <span className="font-semibold text-rose-ink line-through">{item.label}</span>
                    <Badge variant="rose">{display.label}</Badge>
                  </span>
                  <span className="pl-6 text-[0.95rem] text-muted-foreground">{display.reason}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <ComparePlan title={t.llmOnly} icon="llm" view={llm.view} groundedRejected={groundedRejected} />
        <ComparePlan title={t.grounded} icon="grounded" view={grounded.view} groundedRejected={groundedRejected} />
      </div>

      <Link href={`/session?persona=${resolved.persona}`} className={cn(buttonVariants({ size: "lg" }), "h-auto min-h-14 w-fit shrink py-3 whitespace-normal")} data-icon="inline-end">
        {t.openGrounded}
        <ArrowRightIcon aria-hidden />
      </Link>
    </div>
  );
}

function ComparePlan({
  title,
  icon,
  view,
  groundedRejected,
}: {
  title: string;
  icon: "llm" | "grounded";
  view: SessionView;
  groundedRejected: RejectedItem[];
}) {
  const t = getMessages().compare;
  const tr = getMessages().trace;
  const ts = getMessages().step;
  const caught = view.rejected.filter((r) => r.phase !== "replan");
  const Icon = icon === "llm" ? BotIcon : SearchCheckIcon;
  return (
    <section
      aria-label={title}
      className={cn("flex flex-col gap-4 rounded-3xl border bg-card p-5 shadow-paper sm:p-6", icon === "grounded" ? "border-sage/50" : "border-border")}
      data-testid={`compare-${icon}`}
    >
      <div className="flex items-center gap-3">
        <span className={cn("flex size-10 items-center justify-center rounded-full", icon === "grounded" ? "bg-sage-soft text-sage-ink" : "bg-clay-soft text-clay-ink")}>
          <Icon className="size-5" aria-hidden />
        </span>
        <h2 className="text-2xl font-semibold">{title}</h2>
      </div>
      <ol className="flex flex-wrap gap-1.5" aria-label={getMessages().trace.title}>
        {SESSION_PHASES.map((phase) => {
          const status = view.phases.find((p) => p.key === phase)?.status ?? "pending";
          return (
            <li
              key={phase}
              className={cn(
                "rounded-full px-2.5 py-0.5 text-sm font-semibold",
                status === "completed" && "bg-sage-soft text-sage-ink",
                status === "started" && "animate-pulse bg-primary text-primary-foreground",
                status === "skipped" && "border border-dashed border-input text-muted-foreground line-through",
                status === "pending" && "bg-muted text-muted-foreground",
              )}
            >
              {tr.phases[phase]}
              <span className="sr-only"> ({tr.status[status]})</span>
            </li>
          );
        })}
      </ol>

      <div className="rounded-2xl bg-paper-deep p-4">
        <h3 className="mb-2 font-sans text-base font-bold">{t.caughtTitle}</h3>
        {caught.length === 0 ? (
          <p className="text-muted-foreground">{icon === "llm" ? t.llmBlind : t.caughtNone}</p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {caught.map((item) => {
              const display = rejectionDisplay(item);
              const showQlooMiss = item.kind === "not_found" && item.catchSource === "qloo";
              return (
                <li key={`${item.label}-${item.kind}`} className="flex flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <CircleSlashIcon className="size-4 text-rose" aria-hidden />
                    <span className="font-semibold text-rose-ink line-through">{item.label}</span>
                    <Badge variant="rose">{display.label}</Badge>
                  </span>
                  <span className="pl-6 text-[0.95rem] text-muted-foreground">{display.reason}</span>
                  {showQlooMiss && (
                    <span className="pl-6 text-xs break-words text-sage-ink" data-testid="caught-qloo-miss">
                      {qlooNotFoundLine(item.label, item.qlooResultCount)}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {view.steps.length === 0 ? (
        <p className="text-muted-foreground">{view.status === "streaming" ? t.working : view.failure?.message}</p>
      ) : (
        <ol className="flex flex-col divide-y divide-border">
          {view.steps.map((step) => {
            const StepIcon = STEP_ICON[step.kind];
            const slip =
              icon === "llm" && !step.entity ? wouldSlip(step.title, groundedRejected) : undefined;
            return (
              <li
                key={step.id}
                className={cn(
                  "flex animate-rise flex-col gap-1.5 py-3",
                  slip && "my-1 rounded-xl border border-rose/60 bg-rose-soft/30 px-3",
                )}
                data-testid="compare-step"
                data-slip={slip ? "true" : undefined}
              >
                <div className="flex items-start gap-3">
                  <StepIcon className="mt-1 size-5 shrink-0 text-muted-foreground" aria-label={ts.kinds[step.kind]} />
                  <span className={cn("flex-1 font-semibold leading-snug", slip && "text-rose-ink")}>{step.title}</span>
                  <span className="shrink-0 text-sm text-muted-foreground">{ts.minutes(step.durationMin)}</span>
                </div>
                <span className="flex flex-wrap items-center gap-2 pl-8">
                  <ProvenanceBadge step={step} />
                  {slip && (
                    <span className="inline-flex items-center gap-1.5">
                      <TriangleAlertIcon className="size-4 text-rose" aria-hidden />
                      <Badge variant="rose">{t.wouldSlip}</Badge>
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
