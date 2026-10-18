/**
 * Pure tests for the events-to-view reducer (no browser needed). They live in
 * tests/e2e because W-UI owns this folder; Playwright runs them in Node.
 */
import { expect, test } from "@playwright/test";
import { initialView, reduceView, viewFromEvents } from "@/components/session/view-state";
import {
  SAMPLE_GROUNDED_EVENTS,
  SAMPLE_LLM_ONLY_EVENTS,
  SAMPLE_PLAN,
  SAMPLE_REPLAN_EVENTS,
} from "@/lib/domain/sample-events";

test.describe("view-state reducer", () => {
  // Pure Node tests: one project is enough.
  test.skip(({ isMobile }) => isMobile, "runs in the desktop project only");
  test("grounded sample stream builds the full trace and plan", () => {
    const view = viewFromEvents(SAMPLE_GROUNDED_EVENTS);
    expect(view.status).toBe("done");
    expect(view.phases.map((p) => [p.phase, p.status])).toEqual([
      ["parse", "completed"],
      ["propose", "completed"],
      ["verify", "completed"],
      ["expand", "completed"],
      ["critique", "completed"],
      ["compose", "completed"],
    ]);
    expect(view.anchors?.birthYear).toBe(1942);
    expect(view.candidates).toBe(11);
    expect(view.qlooCalls).toBe(4);
    expect(Object.keys(view.entities)).toHaveLength(12);
    expect(view.rejected.map((r) => r.kind)).toEqual(["not_found", "anachronism", "emotional_risk", "anachronism"]);
    expect(view.plan?.id).toBe(SAMPLE_PLAN.id);
    expect(view.steps).toHaveLength(SAMPLE_PLAN.steps.length);
    expect(view.done?.stats.qlooCalls).toBe(13);
    // Items land in the phase that produced them.
    const expand = view.phases.find((p) => p.phase === "expand");
    expect(expand?.items.filter((i) => i.kind === "qloo_call")).toHaveLength(2);
    expect(expand?.items.filter((i) => i.kind === "verified")).toHaveLength(3);
    const critique = view.phases.find((p) => p.phase === "critique");
    expect(critique?.items.every((i) => i.kind === "rejected")).toBe(true);
  });

  test("llm-only stream marks verify and expand as skipped", () => {
    const view = viewFromEvents(SAMPLE_LLM_ONLY_EVENTS);
    expect(view.phases.find((p) => p.phase === "verify")?.status).toBe("skipped");
    expect(view.phases.find((p) => p.phase === "expand")?.status).toBe("skipped");
    expect(view.qlooCalls).toBe(0);
    expect(view.plan?.steps.every((s) => s.provenance === "llm-only")).toBe(true);
  });

  test("steps stream in progressively before the plan replaces them", () => {
    const firstPlan = SAMPLE_GROUNDED_EVENTS.findIndex((e) => e.type === "plan");
    const partial = viewFromEvents(SAMPLE_GROUNDED_EVENTS.slice(0, firstPlan - 3));
    expect(partial.plan).toBeUndefined();
    expect(partial.steps.length).toBe(SAMPLE_PLAN.steps.length - 3);
    expect(partial.status).toBe("streaming");
  });

  test("replan appends a replan phase and highlights changed steps", () => {
    let view = viewFromEvents(SAMPLE_GROUNDED_EVENTS);
    view = reduceView(view, { type: "replan-start" });
    expect(view.replanning).toBe(true);
    for (const event of SAMPLE_REPLAN_EVENTS) view = reduceView(view, { type: "event", event, stream: "replan" });
    expect(view.replanning).toBe(false);
    expect(view.plan?.meta.revision).toBe(1);
    expect(view.adaptations).toBe(1);
    expect(view.changedStepIds).toContain("s_murolo");
    expect(view.removedStepLabels).toEqual(["Forza Napoli: the Sívori years"]);
    expect(view.lastReplan).toEqual({ n: 1, outcome: "adapted" });
    const replan = view.phases.at(-1);
    expect(replan?.key).toBe("replan-1");
    expect(replan?.status).toBe("completed");
    // The session summary is untouched by the replan stream.
    expect(view.done?.traceId).toBe("sample-trace-maria");
  });

  test("a replan that overlaps the end of the session stream keeps both outcomes", async () => {
    const planIndex = SAMPLE_GROUNDED_EVENTS.findIndex((e) => e.type === "plan");
    let view = viewFromEvents(SAMPLE_GROUNDED_EVENTS.slice(0, planIndex + 1));
    expect(view.status).toBe("streaming");
    view = reduceView(view, { type: "replan-start" });
    for (const event of SAMPLE_REPLAN_EVENTS) view = reduceView(view, { type: "event", event, stream: "replan" });
    for (const event of SAMPLE_GROUNDED_EVENTS.slice(planIndex + 1)) view = reduceView(view, { type: "event", event, stream: "session" });
    expect(view.status).toBe("done");
    expect(view.replanning).toBe(false);
    expect(view.plan?.meta.revision).toBe(1);
    expect(view.adaptations).toBe(1);
  });

  test("a fatal error event ends in the error state, a recoverable one only warns", () => {
    let view = reduceView(initialView(), { type: "start" });
    view = reduceView(view, {
      type: "event",
      event: { type: "error", code: "qloo_unavailable", message: "Qloo is unavailable.", recoverable: true, phase: "verify", seq: 0, t: 0 },
    });
    expect(view.warnings).toHaveLength(1);
    expect(view.failure).toBeUndefined();
    view = reduceView(view, {
      type: "event",
      event: { type: "error", code: "llm_unavailable", message: "The model is unavailable.", recoverable: false, seq: 1, t: 1 },
    });
    view = reduceView(view, {
      type: "event",
      event: {
        type: "done",
        traceId: "x",
        durationMs: 2,
        stats: { candidates: 0, verified: 0, rejected: 0, steps: 0, llmCalls: 1, qlooCalls: 0, cacheHits: 0 },
        seq: 2,
        t: 2,
      },
    });
    expect(view.status).toBe("error");
    expect(view.failure?.code).toBe("llm_unavailable");
  });

  test("transport failure and cancel", () => {
    const started = reduceView(initialView(), { type: "start" });
    expect(reduceView(started, { type: "failed", failure: { code: "network", message: "lost" } }).status).toBe("error");
    const cancelled = reduceView(started, { type: "failed", failure: { code: "cancelled", message: "Stopped." } });
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.failure).toBeUndefined();
  });
});
