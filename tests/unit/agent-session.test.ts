import { describe, expect, it } from "vitest";

import { MockQloo } from "@/lib/adapters/qloo/mock";
import { runSession } from "@/lib/agent";
import type { AgentEvent, AgentEventOf, PersonInputDraft } from "@/lib/domain/types";
import { SessionRequest } from "@/lib/domain/types";
import { PERSONAS } from "@/lib/personas";
import type { LlmPort, TastePort } from "@/lib/ports";
import { PortError } from "@/lib/ports";

import { collect, mockDeps } from "./agent-deps";
import { testCtx } from "./helpers";
import { assertStreamRules } from "./stream-rules";

const maria = PERSONAS.find((p) => p.slug === "maria")!;
const request = (person: PersonInputDraft = maria.input, mode: "grounded" | "llm-only" = "grounded") => SessionRequest.parse({ person, mode });
const ofType = <K extends AgentEvent["type"]>(events: AgentEvent[], type: K) => events.filter((e): e is AgentEventOf<K> => e.type === type);
const planOf = (events: AgentEvent[]) => ofType(events, "plan")[0]?.plan;

/** Wrap a taste port and record every query that actually reached it. */
function spyTaste(inner: TastePort) {
  const calls: unknown[] = [];
  const port: TastePort = {
    mode: inner.mode,
    search: (q, c) => (calls.push(q), inner.search(q, c)),
    getEntities: (q, c) => (calls.push(q), inner.getEntities(q, c)),
    insights: (q, c) => (calls.push(q), inner.insights(q, c)),
    searchTags: (q, c) => (calls.push(q), inner.searchTags(q, c)),
  };
  return { port, calls };
}

describe("runSession (grounded, mock mode)", () => {
  it("follows the stream contract and produces a grounded plan", async () => {
    const events = await collect(runSession(mockDeps(), request(), testCtx()));
    assertStreamRules(events, "session");
    const plan = planOf(events)!;
    expect(plan.mode).toBe("grounded");
    expect(plan.meta).toMatchObject({ llmProvider: "mock", llmModel: "mock-llm", qlooMode: "mock", revision: 0 });
    expect(Object.keys(plan.meta.promptVersions).sort()).toEqual(["compose-session", "critique-items", "parse-anchors", "propose-candidates"]);
    expect(plan.steps.reduce((n, s) => n + s.durationMin, 0)).toBe(plan.totalMinutes);
    expect(plan.totalMinutes).toBe(20);
    expect(plan.steps.map((s) => s.order)).toEqual(plan.steps.map((_, i) => i));
    for (const step of plan.steps) expect(step.provenance).toBe(step.entity ? "qloo-grounded" : "llm-only");
    expect(plan.steps.filter((s) => s.provenance === "qloo-grounded").length).toBeGreaterThanOrEqual(4);
    expect(plan.steps[0].kind).toBe("opening");
    expect(plan.steps.at(-1)!.kind).toBe("closing");
    expect(ofType(events, "step").map((e) => e.step)).toEqual(plan.steps);
  });

  it("never puts a rejected item into the plan", async () => {
    const events = await collect(runSession(mockDeps(), request(), testCtx()));
    const rejected = ofType(events, "rejected").map((e) => e.item);
    expect(rejected.map((r) => r.label)).toEqual(
      expect.arrayContaining(["Festival di Napoli 1958", "Pino Daniele", "Le quattro giornate di Napoli", "Diego Maradona"]),
    );
    const plan = planOf(events)!;
    const inPlan = new Set(plan.steps.flatMap((s) => (s.entity ? [s.entity.id, s.entity.name] : [])));
    for (const r of rejected) {
      expect(inPlan.has(r.label)).toBe(false);
      if (r.refId) expect(inPlan.has(r.refId)).toBe(false);
    }
  });

  it("verifies with exact matches or the match-entity LLM, and expands with era filters", async () => {
    const seamus = PERSONAS.find((p) => p.slug === "seamus")!;
    const events = await collect(runSession(mockDeps(), request(seamus.input), testCtx()));
    const verified = ofType(events, "verified").map((e) => e.entity);
    // "Royal Showband" has no exact match; the LLM picks "The Royal Showband".
    expect(verified.find((v) => v.name === "The Royal Showband")?.provenance).toBe("llm-proposed-qloo-verified");
    expect(ofType(events, "rejected").find((r) => r.item.label === "Glen Rovers")?.item.kind).toBe("not_found");
    const affinity = verified.filter((v) => v.provenance === "qloo-affinity");
    expect(affinity.length).toBeGreaterThan(0);
    for (const a of affinity) {
      expect(a.seedQlooIds?.length).toBeGreaterThan(0);
      expect(verified.filter((v) => v.qlooId === a.qlooId)).toHaveLength(1);
    }
    const artistCall = ofType(events, "qloo_call").find((e) => e.call.params["filter.type"] === "urn:entity:artist")!;
    expect(artistCall.call.params["operator.signal.interests.tags"]).toBe("union");
    const movieCall = ofType(events, "qloo_call").find((e) => e.call.params["filter.type"] === "urn:entity:movie")!;
    expect(movieCall.call.params).toMatchObject({
      "filter.release_year.min": 1948,
      "filter.release_year.max": 1968,
      "signal.location.query": "Cork",
      "signal.demographics.age": "55_and_older",
      "bias.trends": "off",
    });
  });

  it("wraps Qloo with the personal-data guard: the display name and private names never reach Qloo", async () => {
    const spy = spyTaste(new MockQloo({ defaultTake: 10 }));
    const person = { ...maria.input, displayName: "Renato Carosone" };
    const events = await collect(runSession(mockDeps({ taste: spy.port }), request(person), testCtx()));
    assertStreamRules(events, "session");
    const sent = JSON.stringify(spy.calls);
    expect(sent).not.toContain("Renato Carosone");
    expect(sent).not.toContain("Gennaro");
    expect(sent).not.toContain(maria.input.notes.slice(0, 30));
    const blocked = ofType(events, "rejected").find((e) => e.item.label === "Renato Carosone")!;
    expect(blocked.item.kind).toBe("not_found");
    expect(ofType(events, "qloo_call")).toHaveLength(spy.calls.length);
  });

  it("caps candidates per domain from config", async () => {
    const events = await collect(runSession(mockDeps({}, { MAX_CANDIDATES_PER_DOMAIN: "1" }), request(), testCtx()));
    const domains = ofType(events, "candidate").map((e) => e.candidate.domain);
    expect(new Set(domains).size).toBe(domains.length);
  });

  it("handles custom input from structured fields only", async () => {
    const person = { notes: "He was a baker in Lyon and loved the cinema.", birthYear: 1948, birthPlace: "Lyon", sessionLanguage: "fr", sessionMinutes: 15 };
    const events = await collect(runSession(mockDeps(), request(person), testCtx()));
    assertStreamRules(events, "session");
    const plan = planOf(events)!;
    expect(plan.totalMinutes).toBe(15);
    expect(plan.language).toBe("fr");
    expect(plan.steps.some((s) => s.promptTranslation)).toBe(true);
  });
});

describe("runSession (llm-only)", () => {
  it("skips verify and expand, makes no Qloo calls and marks every step llm-only", async () => {
    const spy = spyTaste(new MockQloo({ defaultTake: 10 }));
    const events = await collect(runSession(mockDeps({ taste: spy.port }), request(maria.input, "llm-only"), testCtx()));
    assertStreamRules(events, "session");
    const skipped = ofType(events, "phase").filter((e) => e.status === "skipped").map((e) => e.phase);
    expect(skipped).toEqual(["verify", "expand"]);
    expect(spy.calls).toHaveLength(0);
    const plan = planOf(events)!;
    expect(plan.meta.qlooMode).toBe("unused");
    expect(plan.mode).toBe("llm-only");
    expect(plan.steps.every((s) => s.provenance === "llm-only" && !s.entity)).toBe(true);
  });
});

describe("runSession degradation", () => {
  const failingTaste: TastePort = {
    mode: "live",
    search: async () => {
      throw new PortError("taste", "unavailable", "down", true);
    },
    getEntities: async () => {
      throw new PortError("taste", "unavailable", "down", true);
    },
    insights: async () => {
      throw new PortError("taste", "unavailable", "down", true);
    },
    searchTags: async () => {
      throw new PortError("taste", "unavailable", "down", true);
    },
  };

  it("Qloo failure: one recoverable error, then an llm-only plan", async () => {
    const events = await collect(runSession(mockDeps({ taste: failingTaste }), request(), testCtx()));
    assertStreamRules(events, "session");
    const errors = ofType(events, "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: "qloo_unavailable", recoverable: true, phase: "verify" });
    expect(ofType(events, "phase").find((e) => e.phase === "expand")?.status).toBe("skipped");
    const plan = planOf(events)!;
    expect(plan.steps.every((s) => s.provenance === "llm-only")).toBe(true);
    expect(plan.meta.qlooMode).toBe("live");
  });

  it("LLM failure: a fatal error, then done, and no plan", async () => {
    const llm: LlmPort = {
      mode: "live",
      provider: "gemini",
      model: "m",
      generateObject: async () => {
        throw new PortError("llm", "unavailable", "provider said: secret prompt text", true);
      },
    };
    const events = await collect(runSession(mockDeps({ llm }), request(), testCtx()));
    assertStreamRules(events, "session", false);
    const error = ofType(events, "error")[0];
    expect(error).toMatchObject({ code: "llm_unavailable", recoverable: false, phase: "parse" });
    expect(error.message).not.toContain("secret");
    expect(events.at(-1)!.type).toBe("done");
  });

  it("deadline: stops with deadline_exceeded and still ends with done", async () => {
    const deps = mockDeps();
    const slow: LlmPort = {
      mode: "live",
      provider: "x",
      model: "y",
      generateObject: (_req, ctx) =>
        new Promise((_resolve, reject) =>
          ctx.signal?.addEventListener("abort", () => reject(new PortError("llm", "timeout", "aborted", false)), { once: true }),
        ),
    };
    const fast = { ...deps, llm: slow, config: { ...deps.config, agent: { ...deps.config.agent, deadlineMs: 30 } } };
    const events = await collect(runSession(fast, request(), testCtx()));
    expect(ofType(events, "error")[0]).toMatchObject({ code: "deadline_exceeded", recoverable: false });
    expect(events.at(-1)!.type).toBe("done");
  });

  it("client abort: stops promptly", async () => {
    const controller = new AbortController();
    controller.abort();
    const events = await collect(runSession(mockDeps(), request(), testCtx({ signal: controller.signal })));
    expect(ofType(events, "error")[0]?.code).toBe("deadline_exceeded");
    expect(events.at(-1)!.type).toBe("done");
  });
});
