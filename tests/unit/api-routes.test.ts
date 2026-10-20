import { beforeEach, describe, expect, it } from "vitest";

import { rateLimiters } from "@/app/api/_lib/http";

import { POST as replan } from "@/app/api/session/replan/route";
import { POST as session, maxDuration } from "@/app/api/session/route";
import { _resetAgentDepsForTests } from "@/lib/composition";
import { PERSONAS } from "@/lib/personas";

const maria = PERSONAS.find((p) => p.slug === "maria")!;

beforeEach(() => {
  rateLimiters.session.reset();
  rateLimiters.replan.reset();
  _resetAgentDepsForTests();
});

const post = (url: string, body: unknown, headers: Record<string, string> = { "content-type": "application/json" }) =>
  new Request(`http://localhost${url}`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });

/**
 * Unit tests focus on validation-layer behaviour that fails BEFORE composition
 * is reached (invalid input, bad JSON, wrong content type, oversize body).
 * The streaming happy path is exercised end-to-end in Playwright against the
 * replay fixtures, and in `tests/unit/replay-route.test.ts` directly against
 * the committed NDJSON files.
 */
describe("POST /api/session (validation layer only)", () => {
  it("sets maxDuration to 60s (Vercel Hobby budget)", () => {
    expect(maxDuration).toBe(60);
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

describe("POST /api/session/replan (validation layer only)", () => {
  it("rejects invalid bodies before touching composition", async () => {
    const res = await replan(post("/api/session/replan", { stepId: "x" }));
    expect(res.status).toBe(400);
  });
});
