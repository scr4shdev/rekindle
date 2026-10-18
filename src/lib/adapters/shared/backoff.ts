/** Retry pacing shared by the live adapters (bounded, abortable). */

export const BACKOFF_BASE_MS = 300;
export const BACKOFF_MAX_MS = 4_000;

export type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;

/** Exponential backoff before retry `attempt` (1-based): 300 ms, 600 ms, 1.2 s, ... capped. */
export function backoffMs(attempt: number, baseMs = BACKOFF_BASE_MS, maxMs = BACKOFF_MAX_MS): number {
  return Math.min(baseMs * 2 ** (attempt - 1), maxMs);
}

/** Resolves after `ms`, or immediately when `signal` aborts. */
export const abortableSleep: Sleep = (ms, signal) =>
  new Promise((resolve) => {
    if (ms <= 0 || signal?.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });
