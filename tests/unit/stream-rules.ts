import { expect } from "vitest";

import type { AgentEvent, AgentEventOf, AgentPhase } from "@/lib/domain/types";
import { AgentEvent as AgentEventSchema } from "@/lib/domain/types";

const SESSION_PHASES: AgentPhase[] = ["parse", "propose", "verify", "expand", "critique", "compose"];

/** Assert the stream rules of docs/api.md ("Event stream rules"). */
export function assertStreamRules(events: AgentEvent[], kind: "session" | "replan", expectPlan = true): void {
  expect(events.length).toBeGreaterThan(0);
  events.forEach((e, i) => {
    expect(AgentEventSchema.safeParse(e).success).toBe(true);
    expect(e.seq).toBe(i);
    if (i > 0) expect(e.t).toBeGreaterThanOrEqual(events[i - 1].t);
  });
  expect(events.at(-1)!.type).toBe("done");
  expect(events.filter((e) => e.type === "done")).toHaveLength(1);

  // Phases: started then completed, or a single skipped; in order.
  const phaseEvents = events.filter((e) => e.type === "phase");
  const seen: AgentPhase[] = [];
  const open = new Set<AgentPhase>();
  for (const e of phaseEvents) {
    if (e.status === "started") {
      expect(open.has(e.phase)).toBe(false);
      open.add(e.phase);
      seen.push(e.phase);
    } else if (e.status === "completed") {
      expect(open.has(e.phase)).toBe(true);
      open.delete(e.phase);
      expect(e.durationMs).toBeGreaterThanOrEqual(0);
    } else {
      expect(seen).not.toContain(e.phase);
      seen.push(e.phase);
    }
  }
  const order = kind === "session" ? SESSION_PHASES : (["replan"] as AgentPhase[]);
  expect(seen).toEqual(order.slice(0, seen.length));

  const fatal = events.some((e) => e.type === "error" && !e.recoverable);
  const plans = events.filter((e) => e.type === "plan");
  if (expectPlan && !fatal) {
    expect(open.size).toBe(0);
    expect(seen).toEqual(order);
    expect(plans).toHaveLength(1);
  } else {
    expect(plans).toHaveLength(0);
  }

  if (kind === "session" && !fatal) {
    const anchors = events.filter((e) => e.type === "anchors");
    expect(anchors).toHaveLength(1);
    const anchorsAt = events.indexOf(anchors[0]);
    const parseDone = events.findIndex((e) => e.type === "phase" && e.phase === "parse" && e.status === "completed");
    expect(anchorsAt).toBeLessThan(parseDone);
  }

  // Every verified item follows the specific qloo_call that produced it.
  const candidates = new Map(events.flatMap((e) => (e.type === "candidate" ? [[e.candidate.id, e.candidate] as const] : [])));
  let lastCall: AgentEventOf<"qloo_call"> | undefined;
  for (const e of events) {
    if (e.type === "qloo_call") lastCall = e;
    if (e.type === "verified") {
      expect(lastCall, `no qloo_call before ${e.entity.name}`).toBeDefined();
      const call = lastCall!.call;
      expect(call.resultCount).toBeGreaterThan(0);
      if (e.entity.provenance === "llm-proposed-qloo-verified") {
        const candidate = candidates.get(e.entity.candidateId ?? "");
        expect(call.endpoint).toBe("/search");
        expect(call.params.query).toBe(candidate?.name);
        expect(call.params.types).toContain(e.entity.qlooType);
      } else {
        expect(call.endpoint).toBe("/v2/insights");
        expect(call.params["filter.type"]).toBe(e.entity.qlooType);
        const seeds = call.params["signal.interests.entities"] as string[];
        expect(e.entity.seedQlooIds?.length).toBeGreaterThan(0);
        for (const seed of e.entity.seedQlooIds ?? []) expect(seeds).toContain(seed);
      }
    }
    // A verify-phase "not found" that made a request follows the search for that same name.
    if (e.type === "rejected" && e.item.phase === "verify" && lastCall?.call.endpoint === "/search" && e.item.reason.startsWith("No confident")) {
      expect(lastCall.call.params.query).toBe(e.item.label);
    }
  }

  const done = events.at(-1)!;
  if (done.type === "done") {
    expect(done.stats.qlooCalls).toBe(events.filter((e) => e.type === "qloo_call").length);
    expect(done.stats.verified).toBe(events.filter((e) => e.type === "verified").length);
    expect(done.stats.rejected).toBe(events.filter((e) => e.type === "rejected").length);
  }
}
