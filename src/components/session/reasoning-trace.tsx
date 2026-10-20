"use client";

import {
  BadgeCheckIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleIcon,
  CircleSlashIcon,
  LoaderCircleIcon,
  RotateCcwIcon,
  TelescopeIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { QlooCallRow } from "@/components/session/qloo-call-row";
import { DOMAIN_ICON } from "@/components/session/icons";
import { qlooCitationForEntity, qlooNotFoundLine } from "@/components/session/qloo-citation";
import { rejectionDisplay } from "@/components/session/rejection-display";
import type { PhaseView, SessionView, TraceItem } from "@/components/session/view-state";
import { Button } from "@/components/ui/button";
import { useMessages } from "@/i18n/provider";
import type { Candidate, RejectedItem, VerifiedEntity } from "@/lib/domain/types";
import { cn } from "@/lib/utils";

/** "A", "A and B", "A, B and C". */
function joinNames(names: string[], and: string): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} ${and} ${names.at(-1)}`;
}

export function ReasoningTrace({ view, className, onRetry }: { view: SessionView; className?: string; onRetry?: () => void }) {
  const messages = useMessages();
  const tr = messages.trace;
  const scroller = useRef<HTMLDivElement>(null);
  const streaming = view.status === "streaming" || view.replanning;
  const itemCount = view.phases.reduce((n, p) => n + p.items.length + 1, 0);
  const verified = Object.keys(view.entities).length;
  const latest = [...view.phases].reverse().find((p) => p.status !== "pending");

  useEffect(() => {
    const el = scroller.current;
    // Follow the stream inside the capped panel (never scrolls the page itself).
    if (!el || !streaming || el.scrollHeight <= el.clientHeight + 4) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [itemCount, streaming]);

  return (
    <section
      aria-labelledby="trace-title"
      className={cn("flex flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-paper", className)}
      data-testid="reasoning-trace"
    >
      <header className="flex flex-col gap-3 border-b border-border bg-paper-deep px-4 py-3 sm:px-5 sm:py-4">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <h2 id="trace-title" className="text-xl font-semibold">
            {tr.title}
          </h2>
          {streaming ? (
            <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-sm font-semibold text-muted-foreground tabular-nums" data-testid="trace-live-count">
                {tr.liveCount(view.qlooCalls, verified)}
              </span>
              <span className="inline-flex items-center gap-2 rounded-full bg-primary px-3 py-1 text-sm font-semibold text-primary-foreground">
                <span className="size-2 animate-pulse rounded-full bg-primary-foreground" aria-hidden />
                {tr.live}
              </span>
            </span>
          ) : view.done ? (
            <span className="text-sm font-semibold text-muted-foreground">{tr.finished((view.done.durationMs / 1000).toFixed(1))}</span>
          ) : null}
        </div>
        <dl className="grid grid-cols-4 gap-1.5 text-center text-xs sm:gap-2 sm:text-base">
          {[
            [view.candidates, tr.stats.ideas, "text-foreground"],
            [verified, tr.stats.verified, "text-sage"],
            [view.rejected.length, tr.stats.rejected, "text-rose"],
            [view.qlooCalls, tr.stats.calls, "text-ochre"],
          ].map(([value, label, tone]) => (
            <div key={label} className="flex flex-col-reverse rounded-xl bg-card px-1 py-1.5 sm:py-2">
              <dt className="text-[0.7rem] leading-tight font-semibold text-muted-foreground sm:text-xs">{label}</dt>
              <dd className={cn("font-heading text-lg font-semibold tabular-nums sm:text-2xl", tone)}>{value}</dd>
            </div>
          ))}
        </dl>
      </header>
      <p className="sr-only" aria-live="polite">
        {latest?.message}
      </p>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5" tabIndex={0} role="region" aria-label={tr.title}>
        <ol className="relative flex flex-col">
          {view.phases.map((phase, i) => (
            <PhaseRow key={phase.key} phase={phase} last={i === view.phases.length - 1} entities={view.entities} onRetry={onRetry} />
          ))}
        </ol>
      </div>
    </section>
  );
}

function PhaseNode({ status }: { status: PhaseView["status"] }) {
  const base = "relative z-10 flex size-9 shrink-0 items-center justify-center rounded-full border-2";
  switch (status) {
    case "started":
      return (
        <span className={cn(base, "animate-glow border-primary bg-primary text-primary-foreground")}>
          <LoaderCircleIcon className="size-5 animate-spin motion-reduce:animate-none" aria-hidden />
        </span>
      );
    case "completed":
      return (
        <span className={cn(base, "border-sage bg-sage-soft text-sage-ink")}>
          <CircleCheckIcon className="size-5" aria-hidden />
        </span>
      );
    case "skipped":
      return (
        <span className={cn(base, "border-dashed border-input bg-card text-muted-foreground")}>
          <CircleDashedIcon className="size-5" aria-hidden />
        </span>
      );
    default:
      return (
        <span className={cn(base, "border-border bg-card text-border")}>
          <CircleIcon className="size-3" aria-hidden />
        </span>
      );
  }
}

function PhaseRow({ phase, last, entities, onRetry }: { phase: PhaseView; last: boolean; entities: SessionView["entities"]; onRetry?: () => void }) {
  const tr = useMessages().trace;
  const pending = phase.status === "pending";
  const candidates = phase.items.filter((i): i is Extract<TraceItem, { kind: "candidate" }> => i.kind === "candidate");
  const others = phase.items.filter((i) => i.kind !== "candidate");
  return (
    <li className="relative flex gap-4 pb-6 last:pb-0" data-phase={phase.phase} data-status={phase.status}>
      {!last && <span className="absolute top-9 bottom-0 left-[17px] w-0.5 bg-border" aria-hidden />}
      <PhaseNode status={phase.status} />
      <div className={cn("flex min-w-0 flex-1 flex-col gap-2 pt-1", pending && "opacity-60")}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <h3 className="font-sans text-lg leading-tight font-bold">{tr.phases[phase.phase]}</h3>
          <span className="text-sm text-muted-foreground">
            <span className="sr-only">{tr.status[phase.status]} </span>
            {phase.durationMs !== undefined && phase.status === "completed" && tr.seconds(phase.durationMs)}
            {phase.status === "skipped" && tr.status.skipped}
          </span>
        </div>
        {phase.message && <p className="text-[0.95rem] leading-snug text-muted-foreground">{phase.message}</p>}
        {candidates.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {candidates.map((c) => (
              <CandidateChip key={c.seq} candidate={c.candidate} />
            ))}
          </ul>
        )}
        {others.length > 0 && (
          <ul className="flex flex-col gap-2">
            {others.map((item) => (
              <li key={item.seq} className="animate-rise">
                <TraceItemView item={item} entities={entities} onRetry={onRetry} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

function CandidateChip({ candidate }: { candidate: Candidate }) {
  const Icon = DOMAIN_ICON[candidate.domain];
  const domains = useMessages().domains;
  return (
    <li
      className="inline-flex animate-rise items-center gap-1.5 rounded-full bg-clay-soft px-3 py-1 text-[0.9rem] text-clay-ink"
      title={candidate.rationale}
    >
      <Icon className="size-4 shrink-0" aria-label={domains[candidate.domain]} />
      <span className="font-semibold">{candidate.name}</span>
      {candidate.year && <span className="tabular-nums opacity-80">{candidate.year}</span>}
    </li>
  );
}

function TraceItemView({ item, entities, onRetry }: { item: TraceItem; entities: SessionView["entities"]; onRetry?: () => void }) {
  const messages = useMessages();
  const tr = messages.trace;
  const sessionT = messages.session;
  switch (item.kind) {
    case "note":
      return <p className="border-l-3 border-ochre/60 pl-3 text-[0.95rem] italic">{item.text}</p>;
    case "qloo_call":
      return <QlooCallRow call={item.call} entities={entities} />;
    case "verified":
      return <VerifiedRow entity={item.entity} entities={entities} />;
    case "rejected":
      return <RejectedRow item={item.item} />;
    case "error":
      return (
        <div
          className={cn(
            "flex flex-wrap items-start gap-2 rounded-xl px-3 py-2 text-[0.95rem]",
            item.recoverable ? "bg-ochre-soft text-ochre-ink" : "bg-rose-soft text-rose-ink",
          )}
        >
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">
            <strong>{item.recoverable ? tr.recoverable : tr.fatal}: </strong>
            {item.message}
          </span>
          {!item.recoverable && onRetry && (
            <Button size="sm" variant="outline" className="shrink-0" onClick={onRetry} data-icon="inline-start" data-testid="trace-retry">
              <RotateCcwIcon aria-hidden />
              {sessionT.retry}
            </Button>
          )}
        </div>
      );
    default:
      return null;
  }
}

function VerifiedRow({ entity, entities }: { entity: VerifiedEntity; entities: SessionView["entities"] }) {
  const tr = useMessages().trace;
  const Icon = DOMAIN_ICON[entity.domain];
  if (entity.provenance === "qloo-affinity") {
    const seeds = (entity.seedQlooIds ?? []).map((id) => entities[id]?.name).filter((n): n is string => Boolean(n));
    const pct = entity.affinity !== undefined ? Math.round(entity.affinity * 100) : undefined;
    return (
      <div className="flex flex-col gap-1.5 rounded-2xl border border-ochre/40 bg-ochre-soft/60 px-3 py-2.5" data-testid="trace-discovery">
        <div className="flex flex-wrap items-center gap-2">
          <TelescopeIcon className="size-4 shrink-0 text-ochre-ink" aria-hidden />
          <span className="text-sm font-semibold text-ochre-ink">{tr.discovery}</span>
          <span className="font-semibold">{entity.name}</span>
          {entity.releaseYear && <span className="text-sm text-muted-foreground tabular-nums">{entity.releaseYear}</span>}
          {pct !== undefined && (
            <span className="ml-auto inline-flex items-center gap-2 text-sm font-semibold text-ochre-ink">
              <span className="h-1.5 w-14 overflow-hidden rounded-full bg-card" aria-hidden>
                <span className="block h-full rounded-full bg-ochre" style={{ width: `${pct}%` }} />
              </span>
              {tr.affinity(pct)}
            </span>
          )}
        </div>
        {seeds.length > 0 && <p className="text-[0.9rem] leading-snug">{tr.affinityLine(joinNames(seeds, tr.and), entity.name)}</p>}
      </div>
    );
  }
  const citation = qlooCitationForEntity(entity);
  return (
    <div className="flex flex-col gap-1 rounded-xl bg-sage-soft/70 px-3 py-1.5 text-sage-ink" data-testid="trace-verified">
      <div className="flex items-center gap-2">
        <BadgeCheckIcon className="size-4 shrink-0" aria-label={tr.verified} />
        <Icon className="size-4 shrink-0 opacity-70" aria-hidden />
        <span className="font-semibold">{entity.name}</span>
        {entity.releaseYear && <span className="text-sm tabular-nums">{entity.releaseYear}</span>}
        <span className="ml-auto truncate text-xs opacity-80">{entity.qlooType.replace("urn:entity:", "")}</span>
      </div>
      {citation && (
        <span className="pl-6 text-xs text-sage-ink/80" data-testid="trace-qloo-citation">
          {citation}
        </span>
      )}
    </div>
  );
}

function RejectedRow({ item }: { item: RejectedItem }) {
  const messages = useMessages();
  const display = rejectionDisplay(item, messages);
  const showQlooMiss = item.kind === "not_found" && item.catchSource === "qloo";
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-rose/30 bg-rose-soft/60 px-3 py-2" data-testid="trace-rejected">
      <div className="flex flex-wrap items-center gap-2">
        <CircleSlashIcon className="size-4 shrink-0 text-rose-ink" aria-hidden />
        <span className="font-semibold text-rose-ink line-through decoration-2">{item.label}</span>
        <span className="rounded-full bg-card px-2 py-0.5 text-xs font-semibold text-rose-ink">{display.label}</span>
      </div>
      <p className="text-[0.9rem] leading-snug">{display.reason}</p>
      {showQlooMiss && (
        <p className="text-xs text-sage-ink" data-testid="trace-qloo-miss">
          {qlooNotFoundLine(item.label, item.qlooResultCount)}
        </p>
      )}
    </div>
  );
}
