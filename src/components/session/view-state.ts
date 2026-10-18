/**
 * Pure reducer from AgentEvents to what the session page shows. No React, no
 * I/O: tested directly in tests/e2e/view-state.spec.ts. Only reshapes
 * structured events (grouping by phase, upserting steps, diffing plans).
 */
import type {
  AgentEvent,
  AgentEventOf,
  AgentPhase,
  Anchors,
  Candidate,
  ErrorCode,
  QlooCallRecord,
  RejectedItem,
  SessionPlan,
  SessionStep,
  VerifiedEntity,
} from "@/lib/domain/types";

export const SESSION_PHASES = ["parse", "propose", "verify", "expand", "critique", "compose"] as const satisfies readonly AgentPhase[];

export type PhaseStatus = "pending" | "started" | "completed" | "skipped";

export type TraceItem =
  | { kind: "note"; seq: number; text: string }
  | { kind: "candidate"; seq: number; candidate: Candidate }
  | { kind: "verified"; seq: number; entity: VerifiedEntity }
  | { kind: "rejected"; seq: number; item: RejectedItem }
  | { kind: "qloo_call"; seq: number; call: QlooCallRecord }
  | { kind: "error"; seq: number; code: ErrorCode; message: string; recoverable: boolean };

export interface PhaseView {
  /** Stable key: the phase name, or "replan-<n>" for the n-th replan run. */
  key: string;
  phase: AgentPhase;
  status: PhaseStatus;
  message?: string;
  durationMs?: number;
  counts?: Record<string, number>;
  items: TraceItem[];
}

export interface StreamFailure {
  code: ErrorCode | "network" | "cancelled";
  message: string;
}

export interface SessionView {
  status: "idle" | "streaming" | "done" | "error" | "cancelled";
  phases: PhaseView[];
  /** Phase view key that receives items without an explicit phase (verified, candidate). */
  currentKey?: string;
  anchors?: Anchors;
  /** Every verified entity seen, by Qloo id (resolves affinity seeds to names). */
  entities: Record<string, VerifiedEntity>;
  rejected: RejectedItem[];
  candidates: number;
  qlooCalls: number;
  /** Steps as they stream in; replaced by `plan.steps` when the plan arrives. */
  steps: SessionStep[];
  plan?: SessionPlan;
  /** Recoverable problems (the agent degraded and kept going). */
  warnings: StreamFailure[];
  /** Fatal problem: no plan will come from this stream. */
  failure?: StreamFailure;
  done?: Omit<AgentEventOf<"done">, "type" | "seq" | "t">;
  /** Replan in flight. */
  replanning: boolean;
  /** Step ids added or changed by the latest replan (for the highlight animation). */
  changedStepIds: string[];
  /** Labels of upcoming steps the latest replan removed. */
  removedStepLabels: string[];
  /** Number of replans started in this view. */
  replans: number;
  /** Number of replans that actually changed upcoming steps. */
  adaptations: number;
}

export type ViewAction =
  | { type: "start" }
  | { type: "event"; event: AgentEvent }
  | { type: "failed"; failure: StreamFailure }
  | { type: "replan-start" }
  | { type: "replan-failed"; failure: StreamFailure };

export function initialView(): SessionView {
  return {
    status: "idle",
    phases: SESSION_PHASES.map((phase) => ({ key: phase, phase, status: "pending", items: [] })),
    entities: {},
    rejected: [],
    candidates: 0,
    qlooCalls: 0,
    steps: [],
    warnings: [],
    replanning: false,
    changedStepIds: [],
    removedStepLabels: [],
    replans: 0,
    adaptations: 0,
  };
}

function replanKey(n: number) {
  return `replan-${n}`;
}

/** Key of the phase view an event with an explicit phase belongs to. */
function keyFor(view: SessionView, phase: AgentPhase): string {
  return phase === "replan" ? replanKey(view.replans) : phase;
}

function updatePhase(view: SessionView, key: string, fn: (p: PhaseView) => PhaseView): PhaseView[] {
  return view.phases.map((p) => (p.key === key ? fn(p) : p));
}

function addItem(view: SessionView, key: string | undefined, item: TraceItem): PhaseView[] {
  if (!key) return view.phases;
  return updatePhase(view, key, (p) => ({ ...p, items: [...p.items, item] }));
}

function upsertStep(steps: SessionStep[], step: SessionStep): SessionStep[] {
  const index = steps.findIndex((s) => s.id === step.id);
  if (index < 0) return [...steps, step].sort((a, b) => a.order - b.order);
  return steps.map((s, i) => (i === index ? step : s));
}

/** Content equality of two steps, ignoring their position. */
function sameStep(a: SessionStep, b: SessionStep): boolean {
  return JSON.stringify({ ...a, order: 0 }) === JSON.stringify({ ...b, order: 0 });
}

function applyEvent(view: SessionView, event: AgentEvent): SessionView {
  switch (event.type) {
    case "phase": {
      const key = keyFor(view, event.phase);
      const exists = view.phases.some((p) => p.key === key);
      const base = exists ? view.phases : [...view.phases, { key, phase: event.phase, status: "pending" as const, items: [] }];
      const phases = base.map((p) =>
        p.key === key
          ? { ...p, status: event.status, message: event.message, durationMs: event.durationMs ?? p.durationMs, counts: event.counts ?? p.counts }
          : p,
      );
      return { ...view, phases, currentKey: event.status === "started" ? key : view.currentKey };
    }
    case "note":
      return { ...view, phases: addItem(view, keyFor(view, event.phase), { kind: "note", seq: event.seq, text: event.text }) };
    case "anchors":
      return { ...view, anchors: event.anchors };
    case "candidate":
      return {
        ...view,
        candidates: view.candidates + 1,
        phases: addItem(view, view.currentKey ?? "propose", { kind: "candidate", seq: event.seq, candidate: event.candidate }),
      };
    case "verified":
      return {
        ...view,
        entities: { ...view.entities, [event.entity.qlooId]: event.entity },
        phases: addItem(view, view.currentKey, { kind: "verified", seq: event.seq, entity: event.entity }),
      };
    case "rejected": {
      const removed = event.item.phase === "replan" ? [...view.removedStepLabels, event.item.label] : view.removedStepLabels;
      return {
        ...view,
        rejected: [...view.rejected, event.item],
        removedStepLabels: removed,
        phases: addItem(view, keyFor(view, event.item.phase), { kind: "rejected", seq: event.seq, item: event.item }),
      };
    }
    case "qloo_call":
      return {
        ...view,
        qlooCalls: view.qlooCalls + 1,
        phases: addItem(view, keyFor(view, event.phase), { kind: "qloo_call", seq: event.seq, call: event.call }),
      };
    case "step":
      if (view.replanning) return { ...view, changedStepIds: [...new Set([...view.changedStepIds, event.step.id])] };
      return { ...view, steps: upsertStep(view.steps, event.step) };
    case "plan": {
      const previous = view.plan;
      const changed = previous
        ? event.plan.steps
            .filter((s) => {
              const before = previous.steps.find((p) => p.id === s.id);
              return !before || !sameStep(before, s);
            })
            .map((s) => s.id)
        : [];
      const changedStepIds = previous ? [...new Set([...view.changedStepIds, ...changed])] : [];
      const adapted = Boolean(previous) && (changedStepIds.length > 0 || view.removedStepLabels.length > 0);
      return {
        ...view,
        plan: event.plan,
        steps: event.plan.steps,
        changedStepIds,
        adaptations: view.adaptations + (adapted ? 1 : 0),
      };
    }
    case "error": {
      const failure: StreamFailure = { code: event.code, message: event.message };
      const key = event.phase ? keyFor(view, event.phase) : view.currentKey;
      const phases = addItem(view, key, {
        kind: "error",
        seq: event.seq,
        code: event.code,
        message: event.message,
        recoverable: event.recoverable,
      });
      return event.recoverable
        ? { ...view, phases, warnings: [...view.warnings, failure] }
        : { ...view, phases, failure: view.replanning ? view.failure : failure, warnings: view.replanning ? [...view.warnings, failure] : view.warnings };
    }
    case "done": {
      const { traceId, durationMs, stats } = event;
      if (view.replanning) return { ...view, replanning: false };
      return { ...view, done: { traceId, durationMs, stats }, status: view.failure ? "error" : "done" };
    }
  }
}

export function reduceView(view: SessionView, action: ViewAction): SessionView {
  switch (action.type) {
    case "start":
      return { ...initialView(), status: "streaming" };
    case "event":
      return applyEvent(view, action.event);
    case "failed":
      return {
        ...view,
        status: action.failure.code === "cancelled" ? "cancelled" : "error",
        failure: action.failure.code === "cancelled" ? view.failure : action.failure,
        replanning: false,
      };
    case "replan-start": {
      const replans = view.replans + 1;
      const key = replanKey(replans);
      return {
        ...view,
        replans,
        replanning: true,
        changedStepIds: [],
        removedStepLabels: [],
        currentKey: key,
        phases: [...view.phases, { key, phase: "replan", status: "pending", items: [] }],
      };
    }
    case "replan-failed":
      return {
        ...view,
        replanning: false,
        warnings: action.failure.code === "cancelled" ? view.warnings : [...view.warnings, action.failure],
      };
  }
}

/** Reduce a whole recorded stream (tests, comparison summaries). */
export function viewFromEvents(events: Iterable<AgentEvent>): SessionView {
  let view = reduceView(initialView(), { type: "start" });
  for (const event of events) view = reduceView(view, { type: "event", event });
  return view;
}
