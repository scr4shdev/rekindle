import { describe, expect, it } from "vitest";

import { createEventStamper, decodeEventLine, encodeEvent, readEventStream, toNdjsonStream } from "@/lib/domain/ndjson";
import {
  SAMPLE_GROUNDED_EVENTS,
  SAMPLE_LLM_ONLY_EVENTS,
  SAMPLE_PLAN,
  SAMPLE_REPLAN_EVENTS,
} from "@/lib/domain/sample-events";
import { AgentEvent, PersonInput, ReplanRequest, SessionPlan, SessionRequest } from "@/lib/domain/types";
import { PERSONAS } from "@/lib/personas";

describe("sample event streams", () => {
  const streams = { grounded: SAMPLE_GROUNDED_EVENTS, llmOnly: SAMPLE_LLM_ONLY_EVENTS, replan: SAMPLE_REPLAN_EVENTS };

  for (const [name, events] of Object.entries(streams)) {
    it(`${name}: every event validates, seq is contiguous, t is monotonic, ends with done`, () => {
      events.forEach((event, i) => {
        expect(() => AgentEvent.parse(event)).not.toThrow();
        expect(event.seq).toBe(i);
        if (i > 0) expect(event.t).toBeGreaterThanOrEqual(events[i - 1].t);
      });
      expect(events.at(-1)?.type).toBe("done");
      expect(events.filter((e) => e.type === "plan")).toHaveLength(1);
    });
  }

  it("grounded plan steps are ordered and durations add up", () => {
    const plan = SessionPlan.parse(SAMPLE_PLAN);
    expect(plan.steps.map((s) => s.order)).toEqual(plan.steps.map((_, i) => i));
    expect(plan.steps.reduce((sum, s) => sum + s.durationMin, 0)).toBe(plan.totalMinutes);
  });

  it("replan request built from the sample validates", () => {
    const anchors = SAMPLE_GROUNDED_EVENTS.find((e) => e.type === "anchors");
    expect(anchors?.type).toBe("anchors");
    if (anchors?.type !== "anchors") return;
    expect(() =>
      ReplanRequest.parse({ plan: SAMPLE_PLAN, anchors: anchors.anchors, stepId: "s_oro", reaction: "upset" }),
    ).not.toThrow();
  });
});

describe("personas", () => {
  it.each(PERSONAS.map((p) => [p.slug, p]))("%s is a valid PersonInput and SessionRequest", (_, persona) => {
    expect(() => PersonInput.parse(persona.input)).not.toThrow();
    expect(SessionRequest.parse({ person: persona.input }).mode).toBe("grounded");
  });
});

describe("ndjson", () => {
  it("round-trips events through a byte stream split at arbitrary points", async () => {
    const text = SAMPLE_REPLAN_EVENTS.map(encodeEvent).join("");
    const bytes = new TextEncoder().encode(text);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 37) controller.enqueue(bytes.slice(i, i + 37));
        controller.close();
      },
    });
    const decoded: AgentEvent[] = [];
    for await (const event of readEventStream(body)) decoded.push(event);
    expect(decoded).toEqual(SAMPLE_REPLAN_EVENTS);
  });

  it("toNdjsonStream encodes an async iterable", async () => {
    async function* gen() {
      yield* SAMPLE_REPLAN_EVENTS;
    }
    const decoded: AgentEvent[] = [];
    for await (const event of readEventStream(toNdjsonStream(gen()))) decoded.push(event);
    expect(decoded).toHaveLength(SAMPLE_REPLAN_EVENTS.length);
  });

  it("stamper assigns seq and t; decoder rejects invalid lines", () => {
    let clock = 1000;
    const stamp = createEventStamper(() => clock);
    const a = stamp({ type: "note", phase: "parse", text: "hello" });
    clock = 1250;
    const b = stamp({ type: "note", phase: "parse", text: "again" });
    expect([a.seq, a.t, b.seq, b.t]).toEqual([0, 0, 1, 250]);
    expect(() => decodeEventLine("{not json")).toThrow();
    expect(() => decodeEventLine(JSON.stringify({ type: "phase", seq: 0, t: 0 }))).toThrow();
  });
});
