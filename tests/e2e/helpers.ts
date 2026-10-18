import type { Page } from "@playwright/test";
import { encodeEvent, NDJSON_CONTENT_TYPE } from "@/lib/domain/ndjson";
import type { AgentEvent, AgentEventPayload } from "@/lib/domain/types";

/** Stamp payloads with seq/t like the server does. */
export function stamp(payloads: AgentEventPayload[]): AgentEvent[] {
  return payloads.map((p, seq) => ({ ...p, seq, t: seq * 10 }) as AgentEvent);
}

export const DONE: AgentEventPayload = {
  type: "done",
  traceId: "e2e-trace",
  durationMs: 10,
  stats: { candidates: 0, verified: 0, rejected: 0, steps: 0, llmCalls: 0, qlooCalls: 0, cacheHits: 0 },
};

/** Serve a streaming route from recorded events (the real client code path: fetch + readEventStream). */
export async function mockStream(page: Page, path: string, events: AgentEvent[] | ((body: unknown) => AgentEvent[])) {
  await page.route(`**${path}`, async (route) => {
    const body: unknown = route.request().postDataJSON();
    const list = typeof events === "function" ? events(body) : events;
    await route.fulfill({ status: 200, headers: { "content-type": NDJSON_CONTENT_TYPE }, body: list.map(encodeEvent).join("") });
  });
}

export async function mockJsonError(page: Page, path: string, status: number, code: string) {
  await page.route(`**${path}`, (route) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ error: { code, message: "Request body is invalid." } }) }),
  );
}
