/**
 * FROZEN CONTRACT (Phase 0). Shared types for all ports.
 */
import type { Logger } from "pino";

/** Per-call context threaded from the route handler through the agent to every port. */
export interface CallContext {
  traceId: string;
  logger: Logger;
  /** Aborted when the client disconnects or the agent deadline passes. */
  signal?: AbortSignal;
}

export type ProviderMode = "live" | "mock";

/** Error thrown by adapters. The agent maps `code` to an ErrorEvent. */
export class PortError extends Error {
  constructor(
    public readonly port: "taste" | "llm" | "cache",
    public readonly code: "unavailable" | "rate_limited" | "timeout" | "invalid_response" | "unauthorized" | "bad_request",
    message: string,
    public readonly retryable: boolean,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "PortError";
  }
}
