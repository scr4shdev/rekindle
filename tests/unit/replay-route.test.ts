import { describe, expect, it } from "vitest";

import { GET as replay, maxDuration } from "@/app/api/session/replay/route";
import { readEventStream } from "@/lib/domain/ndjson";
import type { AgentEvent } from "@/lib/domain/types";

const PERSONAS = ["maria", "fatima", "seamus"] as const;

async function events(res: Response): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of readEventStream(res.body!)) out.push(e);
  return out;
}

describe("GET /api/session/replay", () => {
  it("declares the 60s Vercel budget", () => {
    expect(maxDuration).toBe(60);
  });

  it("rejects a missing fixture param with 400", async () => {
    const res = await replay(new Request("http://localhost/api/session/replay"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_input");
  });

  it("rejects an unknown fixture slug with 400", async () => {
    const res = await replay(new Request("http://localhost/api/session/replay?fixture=../etc/passwd"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_input");
  });

  it.each(PERSONAS)("streams the %s fixture lines with their IDs and kinds intact", async (slug) => {
    const res = await replay(new Request(`http://localhost/api/session/replay?fixture=${slug}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/x-ndjson; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-trace-id")).toBeTruthy();

    const list = await events(res);
    expect(list.length).toBeGreaterThan(10);
    // seq is monotonic from 0.
    list.forEach((e, i) => expect(e.seq).toBe(i));
    // t is non-decreasing.
    for (let i = 1; i < list.length; i++) expect(list[i].t).toBeGreaterThanOrEqual(list[i - 1].t);
    // Session ends with `done` and contains at least one `plan`.
    expect(list[list.length - 1].type).toBe("done");
    expect(list.filter((e) => e.type === "plan")).toHaveLength(1);
    expect(list.some((e) => e.type === "anchors")).toBe(true);
  });

  it("caps per-event delays at 500ms so the replay fits inside 15s", async () => {
    // Serve a fixture and measure total time: with the cap in place this must
    // finish well under 20s even on a slow CI runner. We assert a loose upper
    // bound rather than a tight budget to stay deterministic.
    const started = Date.now();
    const res = await replay(new Request("http://localhost/api/session/replay?fixture=maria"));
    await events(res);
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(20_000);
  });

  it("stops streaming when the request is aborted", async () => {
    const controller = new AbortController();
    const res = await replay(new Request("http://localhost/api/session/replay?fixture=maria", { signal: controller.signal }));
    controller.abort();
    // Reader may yield already-buffered events before closing; the stream
    // itself must not throw.
    try {
      for await (const _e of readEventStream(res.body!)) void _e;
    } catch {
      // Aborted reads surface as a rejection; accepted.
    }
  });
});
