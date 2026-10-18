/**
 * Where AgentEvents come from. One interface, two implementations:
 * - `api`: POST /api/session and /api/session/replan, decoded with readEventStream.
 * - `sample`: replays the recorded streams in src/lib/domain/sample-events.ts
 *   with their original timing (scaled by `speed`). Recorded for Maria only.
 * `auto` uses the API and falls back to the recording when the route is
 * missing (backend not deployed yet) and a recording exists for the persona.
 */
import { NDJSON_CONTENT_TYPE, readEventStream } from "@/lib/domain/ndjson";
import {
  SAMPLE_GROUNDED_EVENTS,
  SAMPLE_LLM_ONLY_EVENTS,
  SAMPLE_PLAN,
  SAMPLE_REPLAN_EVENTS,
  SAMPLE_REPLAN_REQUEST_STEP_ID,
} from "@/lib/domain/sample-events";
import type { AgentEvent, AgentEventPayload, ReplanRequestDraft, SessionRequestDraft } from "@/lib/domain/types";
import { getMessages } from "@/i18n";

export type SourceKind = "api" | "sample";
export type SourceParam = SourceKind | "auto";

export interface StreamOptions {
  signal: AbortSignal;
  /** Called once with the source that actually serves the stream. */
  onResolved?: (kind: SourceKind) => void;
}

export interface AgentEventSource {
  session(request: SessionRequestDraft, options: StreamOptions): AsyncIterable<AgentEvent>;
  replan(request: ReplanRequestDraft, options: StreamOptions): AsyncIterable<AgentEvent>;
}

/** A request the server refused before streaming (4xx/5xx JSON). Never carries submitted text. */
export class StreamRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`Request failed with status ${status}`);
    this.name = "StreamRequestError";
  }
}

async function* postStream(url: string, body: unknown, { signal, onResolved }: StreamOptions): AsyncGenerator<AgentEvent> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: NDJSON_CONTENT_TYPE },
    body: JSON.stringify(body),
    signal,
    cache: "no-store",
  });
  if (!response.ok || !response.body) {
    let code = "internal";
    try {
      const json: unknown = await response.json();
      const candidate = (json as { error?: { code?: unknown } } | null)?.error?.code;
      if (typeof candidate === "string") code = candidate;
    } catch {
      // Not JSON (e.g. a 404 page): keep the generic code.
    }
    throw new StreamRequestError(response.status, code);
  }
  onResolved?.("api");
  yield* readEventStream(response.body);
}

export const apiSource: AgentEventSource = {
  session: (request, options) => postStream("/api/session", request, options),
  replan: (request, options) => postStream("/api/session/replan", request, options),
};

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

async function* replay(events: readonly AgentEvent[], speed: number, signal: AbortSignal): AsyncGenerator<AgentEvent> {
  let previous = 0;
  for (const event of events) {
    const wait = speed > 0 ? (event.t - previous) / speed : 0;
    if (wait > 0) await sleep(wait, signal);
    else if (signal.aborted) throw signal.reason;
    previous = event.t;
    yield event;
  }
}

/** A short synthetic replan for reactions the recording does not cover: same plan, next revision. */
function syntheticReplan(request: ReplanRequestDraft): AgentEvent[] {
  const t = getMessages().sample;
  const plan = { ...request.plan, meta: { ...request.plan.meta, revision: (request.plan.meta.revision ?? 0) + 1 } };
  const payloads: AgentEventPayload[] = [
    { type: "phase", phase: "replan", status: "started", message: t.replanStarted[request.reaction] },
    { type: "note", phase: "replan", text: t.replanNote },
    { type: "plan", plan: { ...plan, steps: plan.steps.map((s) => ({ ...s, followUps: s.followUps ?? [] })) } },
    { type: "phase", phase: "replan", status: "completed", message: t.replanCompleted, durationMs: 900 },
    {
      type: "done",
      traceId: "sample-trace-replan",
      durationMs: 900,
      stats: { candidates: 0, verified: 0, rejected: 0, steps: 0, llmCalls: 0, qlooCalls: 0, cacheHits: 0 },
    },
  ];
  const delays = [0, 600, 200, 100, 0];
  let clock = 0;
  return payloads.map((payload, seq) => {
    clock += delays[seq];
    return { ...payload, seq, t: clock } as AgentEvent;
  });
}

export function sampleSource(speed = 1): AgentEventSource {
  return {
    session(request, { signal, onResolved }) {
      onResolved?.("sample");
      return replay(request.mode === "llm-only" ? SAMPLE_LLM_ONLY_EVENTS : SAMPLE_GROUNDED_EVENTS, speed, signal);
    },
    replan(request, { signal, onResolved }) {
      onResolved?.("sample");
      const recorded =
        request.plan.id === SAMPLE_PLAN.id &&
        (request.plan.meta.revision ?? 0) === 0 &&
        request.stepId === SAMPLE_REPLAN_REQUEST_STEP_ID &&
        request.reaction === "upset";
      return replay(recorded ? SAMPLE_REPLAN_EVENTS : syntheticReplan(request), speed, signal);
    },
  };
}

/** The backend is not there (route missing or unreachable), as opposed to a real error. */
function isMissingBackend(error: unknown): boolean {
  if (error instanceof StreamRequestError) return error.status === 404 || error.status === 405 || error.status === 501;
  return error instanceof TypeError;
}

async function* withFallback(
  primary: () => AsyncIterable<AgentEvent>,
  fallback: (() => AsyncIterable<AgentEvent>) | undefined,
): AsyncGenerator<AgentEvent> {
  let started = false;
  try {
    for await (const event of primary()) {
      started = true;
      yield event;
    }
  } catch (error) {
    if (started || !fallback || !isMissingBackend(error)) throw error;
    yield* fallback();
  }
}

/**
 * Resolve `?source=`. `hasRecording` is true when the request matches the
 * recorded persona, so `auto` may fall back to it.
 */
export function resolveSource(param: SourceParam, { speed = 1, hasRecording = false } = {}): AgentEventSource {
  if (param === "sample") return sampleSource(speed);
  if (param === "api" || !hasRecording) return apiSource;
  const sample = sampleSource(speed);
  return {
    session: (request, options) =>
      withFallback(
        () => apiSource.session(request, options),
        () => sample.session(request, options),
      ),
    replan: (request, options) =>
      withFallback(
        () => apiSource.replan(request, options),
        () => sample.replan(request, options),
      ),
  };
}

export function parseSourceParam(value: string | null): SourceParam {
  return value === "sample" || value === "api" ? value : "auto";
}
