import pino from "pino";
import type { Logger } from "pino";

import type { CallContext } from "@/lib/ports/common";

/** A logger that records every log call (to assert that nothing sensitive is logged). */
export function recordingLogger(): { logger: Logger; lines: string[] } {
  const lines: string[] = [];
  const logger = pino({ level: "trace" }, { write: (line: string) => void lines.push(line) });
  return { logger, lines };
}

export const silentLogger: Logger = pino({ level: "silent" });

export function testCtx(overrides: Partial<CallContext> = {}): CallContext {
  return { traceId: "test-trace", logger: silentLogger, ...overrides };
}
