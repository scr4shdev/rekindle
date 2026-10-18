import { describe, expect, it } from "vitest";

import { runReplan, runSession } from "@/lib/agent";
import type { AgentEvent, AgentEventOf, Reaction, SessionPlan } from "@/lib/domain/types";
import { ReplanRequest, SessionRequest } from "@/lib/domain/types";
import { PERSONAS } from "@/lib/personas";

import { collect, mockDeps } from "./agent-deps";
import { testCtx } from "./helpers";
import { assertStreamRules } from "./stream-rules";

const ofType = <K extends AgentEvent["type"]>(events: AgentEvent[], type: K) => events.filter((e): e is AgentEventOf<K> => e.type === type);

async function session(slug: string, mode: "grounded" | "llm-only" = "grounded") {
  const persona = PERSONAS.find((p) => p.slug === slug)!;
  const events = await collect(runSession(mockDeps(), SessionRequest.parse({ person: persona.input, mode }), testCtx()));
  return { plan: ofType(events, "plan")[0].plan, anchors: ofType(events, "anchors")[0].anchors };
}

async function replan(plan: SessionPlan, anchors: unknown, stepId: string, reaction: Reaction) {
  const req = ReplanRequest.parse({ plan, anchors, stepId, reaction, history: [], note: "She went quiet" });
  return collect(runReplan(mockDeps(), req, testCtx()));
}

function assertPastUnchanged(before: SessionPlan, after: SessionPlan, stepId: string) {
  const reacted = before.steps.find((s) => s.id === stepId)!;
  const past = before.steps.filter((s) => s.order <= reacted.order);
  expect(after.steps.slice(0, past.length)).toEqual(past);
  expect(after.id).toBe(before.id);
  expect(after.meta.revision).toBe(before.meta.revision + 1);
  expect(after.meta.promptVersions["replan-session"]).toBe("1.0.0");
  expect(after.steps.map((s) => s.order)).toEqual(after.steps.map((_, i) => i));
  expect(after.steps.at(-1)!.kind).toBe("closing");
}

describe("runReplan", () => {
  it("upset: calming step next, risky upcoming step removed, past untouched", async () => {
    const { plan, anchors } = await session("maria");
    const look = plan.steps.find((s) => s.kind === "look")!;
    const events = await replan(plan, anchors, look.id, "upset");
    assertStreamRules(events, "replan");
    const next = ofType(events, "plan")[0].plan;
    assertPastUnchanged(plan, next, look.id);
    const removed = ofType(events, "rejected").map((e) => e.item);
    expect(removed).toHaveLength(1);
    expect(removed[0]).toMatchObject({ phase: "replan", kind: "emotional_risk", label: "Forza Napoli: the Sívori years" });
    expect(next.steps.some((s) => s.id === removed[0].refId)).toBe(false);
    const added = ofType(events, "step").map((e) => e.step);
    expect(added).toHaveLength(1);
    expect(next.steps[look.order + 1]).toEqual(added[0]);
    expect(added[0].kind).toBe("listen");
    // Unchanged upcoming steps keep their ids.
    const keptIds = plan.steps.filter((s) => s.order > look.order && s.id !== removed[0].refId).map((s) => s.id);
    for (const id of keptIds) expect(next.steps.some((s) => s.id === id)).toBe(true);
  });

  it("lit_up: Qloo affinity from that entity becomes the next, grounded step", async () => {
    const { plan, anchors } = await session("maria");
    const sinatra = plan.steps.find((s) => s.entity?.name === "Frank Sinatra")!;
    const events = await replan(plan, anchors, sinatra.id, "lit_up");
    assertStreamRules(events, "replan");
    const call = ofType(events, "qloo_call")[0].call;
    expect(call.params).toMatchObject({ "filter.type": "urn:entity:artist", "signal.interests.entities": [sinatra.entity!.qlooId] });
    const inPlan = plan.steps.flatMap((s) => (s.entity ? [s.entity.qlooId] : []));
    expect(call.params["filter.exclude.entities"]).toEqual(expect.arrayContaining(inPlan));
    const fresh = ofType(events, "verified").map((e) => e.entity);
    expect(fresh.length).toBeGreaterThan(0);
    expect(fresh.every((e) => e.provenance === "qloo-affinity")).toBe(true);
    const next = ofType(events, "plan")[0].plan;
    assertPastUnchanged(plan, next, sinatra.id);
    const nextStep = next.steps[sinatra.order + 1];
    expect(nextStep.provenance).toBe("qloo-grounded");
    expect(nextStep.entity?.id).toBe(fresh[0].id);
  });

  it("neutral: changes the kind of the next step without removing anything", async () => {
    const { plan, anchors } = await session("seamus");
    const first = plan.steps[1];
    const events = await replan(plan, anchors, first.id, "neutral");
    assertStreamRules(events, "replan");
    const next = ofType(events, "plan")[0].plan;
    assertPastUnchanged(plan, next, first.id);
    expect(next.steps).toHaveLength(plan.steps.length);
    expect(next.steps[2].kind).not.toBe(first.kind);
    expect(ofType(events, "rejected")).toHaveLength(0);
  });

  it("llm-only plans never call Qloo during a replan", async () => {
    const { plan, anchors } = await session("maria", "llm-only");
    const events = await replan(plan, anchors, plan.steps[1].id, "lit_up");
    assertStreamRules(events, "replan");
    expect(ofType(events, "qloo_call")).toHaveLength(0);
    expect(ofType(events, "plan")[0].plan.steps.every((s) => s.provenance === "llm-only")).toBe(true);
  });

  it("last step: nothing to adapt, revision still increments", async () => {
    const { plan, anchors } = await session("fatima");
    const events = await replan(plan, anchors, plan.steps.at(-1)!.id, "upset");
    assertStreamRules(events, "replan");
    const next = ofType(events, "plan")[0].plan;
    expect(next.steps).toEqual(plan.steps);
    expect(next.meta.revision).toBe(1);
  });

  it("unknown step id: fatal invalid_input, then done", async () => {
    const { plan, anchors } = await session("maria");
    const events = await replan(plan, anchors, "nope", "upset");
    assertStreamRules(events, "replan", false);
    expect(ofType(events, "error")[0]).toMatchObject({ code: "invalid_input", recoverable: false });
  });
});
