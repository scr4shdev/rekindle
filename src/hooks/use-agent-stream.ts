"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { StreamRequestError, type AgentEventSource, type SourceKind } from "@/components/session/source";
import { initialView, reduceView, type StreamFailure } from "@/components/session/view-state";
import { getMessages } from "@/i18n";
import type { AgentEvent, ReplanRequestDraft, SessionRequestDraft } from "@/lib/domain/types";

/** Map a transport failure to a safe, user-facing failure (never echoes input or internals). */
function toFailure(error: unknown, signal: AbortSignal, language?: string): StreamFailure {
  const t = getMessages(language).errors;
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
export function useAgentStream(source: AgentEventSource, language?: string) {
  const [view, dispatch] = useReducer(reduceView, undefined, initialView);
  const [servedBy, setServedBy] = useState<SourceKind | undefined>();
  // Separate controllers: a replan may start while the session stream is still closing.
  const sessionCtrl = useRef<AbortController | null>(null);
  const replanCtrl = useRef<AbortController | null>(null);

  const consume = useCallback(async (events: AsyncIterable<AgentEvent>, ctrl: AbortController, stream: "session" | "replan") => {
    // A stream superseded by a newer one (restart, or React re-running effects) goes quiet.
    const slot = stream === "session" ? sessionCtrl : replanCtrl;
    const current = () => slot.current === ctrl;
    const { signal } = ctrl;
    let sawDone = false;
    try {
      for await (const event of events) {
        if (signal.aborted || !current()) break;
        if (event.type === "done") sawDone = true;
        dispatch({ type: "event", event, stream });
      }
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      if (!sawDone && current()) throw new Error("Stream ended early");
    } catch (error) {
      if (!current()) return;
      const failure = toFailure(error, signal, language);
      dispatch(stream === "session" ? { type: "failed", failure } : { type: "replan-failed", failure });
    } finally {
      if (current()) slot.current = null;
    }
  }, [language]);

  const start = useCallback(
    (request: SessionRequestDraft) => {
      for (const slot of [sessionCtrl, replanCtrl]) {
        const old = slot.current;
        slot.current = null;
        old?.abort();
      }
      const ctrl = new AbortController();
      sessionCtrl.current = ctrl;
      setServedBy(undefined);
      dispatch({ type: "start" });
      void consume(source.session(request, { signal: ctrl.signal, onResolved: setServedBy }), ctrl, "session");
    },
    [consume, source],
  );

  const replan = useCallback(
    (request: ReplanRequestDraft) => {
      replanCtrl.current?.abort();
      const ctrl = new AbortController();
      replanCtrl.current = ctrl;
      dispatch({ type: "replan-start" });
      void consume(source.replan(request, { signal: ctrl.signal }), ctrl, "replan");
    },
    [consume, source],
  );

  /** Stop whatever is streaming (the replan if one is running, else the session). */
  const cancel = useCallback(() => (replanCtrl.current ?? sessionCtrl.current)?.abort(), []);

  useEffect(
    () => () => {
      for (const slot of [sessionCtrl, replanCtrl]) {
        const ctrl = slot.current;
        slot.current = null;
        ctrl?.abort();
      }
    },
    [],
  );

  return { view, servedBy, start, replan, cancel };
}
