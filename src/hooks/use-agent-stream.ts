"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { StreamRequestError, type AgentEventSource, type SourceKind } from "@/components/session/source";
import { initialView, reduceView, type StreamFailure } from "@/components/session/view-state";
import { getMessages } from "@/i18n";
import type { AgentEvent, ReplanRequestDraft, SessionRequestDraft } from "@/lib/domain/types";

/** Map a transport failure to a safe, user-facing failure (never echoes input or internals). */
function toFailure(error: unknown, signal: AbortSignal): StreamFailure {
  const t = getMessages().errors;
  if (signal.aborted) return { code: "cancelled", message: t.cancelled };
  if (error instanceof StreamRequestError) {
    if (error.status === 400 || error.status === 413 || error.status === 415) return { code: "invalid_input", message: t.invalid };
    if (error.status === 429) return { code: "rate_limited", message: t.busy };
    return { code: "internal", message: t.unreachable };
  }
  if (error instanceof TypeError) return { code: "network", message: t.network };
  return { code: "internal", message: t.unknown };
}

/**
 * Streams AgentEvents into a SessionView. `start` (re)runs a session stream,
 * `replan` runs a replan stream on top of the current plan, `cancel` aborts.
 * Any in-flight stream is aborted on unmount.
 */
export function useAgentStream(source: AgentEventSource) {
  const [view, dispatch] = useReducer(reduceView, undefined, initialView);
  const [servedBy, setServedBy] = useState<SourceKind | undefined>();
  const controller = useRef<AbortController | null>(null);

  const consume = useCallback(async (events: AsyncIterable<AgentEvent>, signal: AbortSignal, kind: "session" | "replan") => {
    let sawDone = false;
    try {
      for await (const event of events) {
        if (signal.aborted) break;
        if (event.type === "done") sawDone = true;
        dispatch({ type: "event", event });
      }
      if (!sawDone && !signal.aborted) throw new Error("Stream ended early");
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    } catch (error) {
      const failure = toFailure(error, signal);
      dispatch(kind === "session" ? { type: "failed", failure } : { type: "replan-failed", failure });
    }
  }, []);

  const start = useCallback(
    (request: SessionRequestDraft) => {
      controller.current?.abort();
      const ctrl = new AbortController();
      controller.current = ctrl;
      setServedBy(undefined);
      dispatch({ type: "start" });
      void consume(source.session(request, { signal: ctrl.signal, onResolved: setServedBy }), ctrl.signal, "session");
    },
    [consume, source],
  );

  const replan = useCallback(
    (request: ReplanRequestDraft) => {
      controller.current?.abort();
      const ctrl = new AbortController();
      controller.current = ctrl;
      dispatch({ type: "replan-start" });
      void consume(source.replan(request, { signal: ctrl.signal }), ctrl.signal, "replan");
    },
    [consume, source],
  );

  const cancel = useCallback(() => controller.current?.abort(), []);

  useEffect(() => () => controller.current?.abort(), []);

  return { view, servedBy, start, replan, cancel };
}
