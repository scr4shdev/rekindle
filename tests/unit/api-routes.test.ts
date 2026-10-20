import { beforeEach, describe, expect, it } from "vitest";

import { rateLimiters } from "@/app/api/_lib/http";

import { GET as health } from "@/app/api/health/route";
import { POST as replan } from "@/app/api/session/replan/route";
import { POST as session, maxDuration } from "@/app/api/session/route";
import { readEventStream } from "@/lib/domain/ndjson";
import type { AgentEvent, AgentEventOf } from "@/lib/domain/types";
import { PERSONAS } from "@/lib/personas";

import { assertStreamRules } from "./stream-rules";

const maria = PERSONAS.find((p) => p.slug === "maria")!;

beforeEach(() => {
  rateLimiters.session.reset();
  rateLimiters.replan.reset();
});

const post = (url: string, body: unknown, headers: Record<string, string> = { "content-type": "application/json" }) =>
  new Request(`http://localhost${url}`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });

async function events(res: Response): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of readEventStream(res.body!)) out.push(e);
  return out;
}

const ofType = <K extends AgentEvent["type"]>(list: AgentEvent[], type: K) => list.filter((e): e is AgentEventOf<K> => e.type === type);

describe("GET /api/health", () => {
  it("reports mock mode without secrets and without leaking the mock LLM provider", async () => {
    const res = await health(new Request("http://localhost/api/health"));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-trace-id")).toBeTruthy();
    const body = await res.json();
    expect(body).toMatchObject({ status: "ok", qloo: { mode: "mock", mockReason: "forced" }, llm: { mode: "mock" }, cache: { driver: "memory" } });
    // The LLM block in mock mode is redacted to {mode:"mock"} so a judge
    // inspecting the Network tab does not see "mock-llm" / "missing_key".
    expect(Object.keys(body.llm)).toEqual(["mode"]);
    expect(JSON.stringify(body)).not.toMatch(/apiKey|token/i);
    expect(JSON.stringify(body)).not.toMatch(/mock-llm|missing_key/i);
  });
});

describe("POST /api/session", () => {
  it("streams a grounded NDJSON session that follows the event rules", async () => {
    expect(maxDuration).toBe(60);
    const res = await session(post("/api/session", { person: maria.input }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/x-ndjson; charset=utf-8");
    const traceId = res.headers.get("x-trace-id");
    expect(traceId).toBeTruthy();
    const list = await events(res);
    assertStreamRules(list, "session");
    const done = list.at(-1)!;
    expect(done.type === "done" && done.traceId).toBe(traceId);
    expect(ofType(list, "plan")[0].plan.mode).toBe("grounded");
  });

  it("streams llm-only mode", async () => {
    const list = await events(await session(post("/api/session", { person: maria.input, mode: "llm-only" })));
    assertStreamRules(list, "session");
    expect(ofType(list, "qloo_call")).toHaveLength(0);
  });

  it("rejects invalid input with a 400 JSON before streaming, without echoing values", async () => {
    const res = await session(post("/api/session", { person: { notes: "short", sessionMinutes: 500 } }));
    expect(res.status).toBe(400);
    expect(res.headers.get("x-trace-id")).toBeTruthy();
    const body = await res.json();
    expect(body.error.code).toBe("invalid_input");
    const paths = body.error.issues.map((i: { path: string }) => i.path);
    expect(paths).toEqual(expect.arrayContaining(["person.notes", "person.sessionMinutes"]));
    expect(JSON.stringify(body)).not.toContain("short");
  });

  it("rejects bad JSON (400), wrong content type (415) and bodies over 64 KB (413)", async () => {
    expect((await session(post("/api/session", "{nope"))).status).toBe(400);
    expect((await session(post("/api/session", { person: maria.input }, { "content-type": "text/plain" }))).status).toBe(415);
    const big = { person: { ...maria.input, notes: "x".repeat(70_000) } };
    const res = await session(post("/api/session", big));
    expect(res.status).toBe(413);
    expect((await res.json()).error.code).toBe("payload_too_large");
  });
});

describe("POST /api/session/replan", () => {
  it("streams a replan from a session's plan and anchors", async () => {
    const list = await events(await session(post("/api/session", { person: maria.input })));
    const plan = ofType(list, "plan")[0].plan;
    const anchors = ofType(list, "anchors")[0].anchors;
    const look = plan.steps.find((s) => s.kind === "look")!;
    const res = await replan(post("/api/session/replan", { plan, anchors, stepId: look.id, reaction: "upset", note: "She looked away" }));
    expect(res.status).toBe(200);
    const out = await events(res);
    assertStreamRules(out, "replan");
    const next = ofType(out, "plan")[0].plan;
    expect(next.id).toBe(plan.id);
    expect(next.meta.revision).toBe(1);
  });

  it("rejects an unknown step id and invalid bodies before streaming", async () => {
    const list = await events(await session(post("/api/session", { person: maria.input, mode: "llm-only" })));
    const plan = ofType(list, "plan")[0].plan;
    const anchors = ofType(list, "anchors")[0].anchors;
    const res = await replan(post("/api/session/replan", { plan, anchors, stepId: "missing", reaction: "upset" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.issues).toEqual([{ path: "stepId", message: "Not a step of this plan" }]);
    const bad = await replan(post("/api/session/replan", { plan, anchors, stepId: plan.steps[0].id, reaction: "angry" }));
    expect(bad.status).toBe(400);
  });
});
