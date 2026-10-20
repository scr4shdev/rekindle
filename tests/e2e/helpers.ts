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

/**
 * Pretend the backend has a live LLM so the custom form stays enabled. The
 * form probes /api/health on mount and disables submit when llm.mode is not
 * "live" (the real deployment demo-trap guard). When the webServer has no
 * GEMINI_API_KEY, /api/health reports mode "unavailable"; tests exercising
 * the form must stub it to "live".
 */
export async function mockLiveHealth(page: Page) {
  await page.route("**/api/health", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "ok",
        qloo: { mode: "mock", baseUrl: "https://hackathon.api.qloo.com" },
        llm: { mode: "live", provider: "gemini", model: "gemini-3.1-flash-lite" },
        cache: { driver: "memory" },
      }),
    }),
  );
}
