/**
 * GET /api/session/replay?fixture=<slug>: streams a recorded trace as NDJSON,
 * paced by each event's stamped `t` delta so it feels like a live session.
 *
 * This is a judge-stable safety net: the demo keeps working even if Qloo
 * rate-limits or an LLM key goes stale, because this route consults neither.
 * It just reads a committed `tests/fixtures/trace-<slug>.ndjson` file,
 * validates each line against the frozen AgentEvent schema, and serves them
 * through the same NDJSON contract the real /api/session route uses.
 *
 * Server-only. Depends on filesystem access, so Node runtime (default).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { jsonError } from "@/app/api/_lib/http";
import { decodeEventLine, NDJSON_CONTENT_TYPE } from "@/lib/domain/ndjson";
import type { AgentEvent } from "@/lib/domain/types";
import { createRequestLogger, newTraceId } from "@/lib/logger";

// Node.js runtime (default). Needed for fs; same budget as /api/session.
export const maxDuration = 60;

/** Allowed fixture slugs. Hardcoded so arbitrary `?fixture=` input cannot read the filesystem. */
const ALLOWED_SLUGS = new Set(["maria", "fatima", "seamus"]);

/** Per-event delay cap: judges don't have patience for the real recorded gaps. */
const MAX_INTER_EVENT_DELAY_MS = 500;
/** Total replay budget: whole trace streams in under this. */
const MAX_TOTAL_REPLAY_MS = 15_000;

/** Resolve the fixture file path from a validated slug. */
function fixturePath(slug: string): string {
  return path.join(process.cwd(), "tests", "fixtures", `trace-${slug}.ndjson`);
}

/** Decode the NDJSON file into a validated AgentEvent list. Validates each line. */
async function loadFixture(slug: string): Promise<AgentEvent[] | undefined> {
  let raw: string;
  try {
    raw = await readFile(fixturePath(slug), "utf-8");
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return undefined;
    throw error;
  }
  const events: AgentEvent[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    events.push(decodeEventLine(trimmed));
  }
  return events;
}

/**
 * Compute the paced schedule: for each event, how long to wait after the
 * previous event before emitting it. Each gap is capped at
 * MAX_INTER_EVENT_DELAY_MS, and once the running total hits
 * MAX_TOTAL_REPLAY_MS the remaining events emit with zero delay.
 */
function pacedDelays(events: AgentEvent[]): number[] {
  const delays: number[] = [];
  let elapsed = 0;
  let previous = 0;
  for (const event of events) {
    const raw = Math.max(0, event.t - previous);
    const capped = Math.min(raw, MAX_INTER_EVENT_DELAY_MS);
    const remaining = Math.max(0, MAX_TOTAL_REPLAY_MS - elapsed);
    const delay = Math.min(capped, remaining);
    delays.push(delay);
    elapsed += delay;
    previous = event.t;
  }
  return delays;
}

/** Readable stream that paces the events, respecting an AbortSignal. */
function pacedStream(events: AgentEvent[], signal: AbortSignal): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const delays = pacedDelays(events);
  let index = 0;
  let closed = false;
  let timer: NodeJS.Timeout | undefined;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const abort = () => {
        if (closed) return;
        closed = true;
        if (timer) clearTimeout(timer);
        try {
          controller.close();
        } catch {
          // Already closed by `pull` reaching the end; ignore.
        }
      };
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    },
    pull(controller) {
      if (closed || signal.aborted) {
        if (!closed) {
          closed = true;
          controller.close();
        }
        return;
      }
      if (index >= events.length) {
        closed = true;
        controller.close();
        return;
      }
      const wait = delays[index];
      const emit = () => {
        timer = undefined;
        if (closed || signal.aborted) return;
        const event = events[index++];
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      if (wait <= 0) {
        emit();
      } else {
        timer = setTimeout(emit, wait);
      }
    },
    cancel() {
      closed = true;
      if (timer) clearTimeout(timer);
    },
  });
}

export async function GET(request: Request): Promise<Response> {
  const traceId = newTraceId();
  const logger = createRequestLogger(traceId, { route: "session-replay" });
  const url = new URL(request.url);
  const slug = url.searchParams.get("fixture");
  if (!slug || !ALLOWED_SLUGS.has(slug)) {
    logger.info({ status: 400 }, "replay request rejected");
    return jsonError(400, "invalid_input", "Unknown fixture.", traceId, [
      { path: "fixture", message: "Must be one of: maria, fatima, seamus" },
    ]);
  }
  let events: AgentEvent[] | undefined;
  try {
    events = await loadFixture(slug);
  } catch (error) {
    logger.error({ err: error instanceof Error ? error.name : typeof error }, "replay fixture failed to load");
    return jsonError(500, "internal", "The replay fixture could not be read.", traceId);
  }
  if (!events) {
    logger.info({ status: 404, fixture: slug }, "replay fixture missing");
    return Response.json(
      { error: { code: "invalid_input", message: `No recorded trace for '${slug}'. Run scripts/record-trace.ts to produce one.` } },
      { status: 404, headers: { "x-trace-id": traceId, "cache-control": "no-store" } },
    );
  }
  logger.info({ fixture: slug, events: events.length }, "replay started");
  return new Response(pacedStream(events, request.signal), {
    status: 200,
    headers: {
      "content-type": NDJSON_CONTENT_TYPE,
      "x-trace-id": traceId,
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
}
