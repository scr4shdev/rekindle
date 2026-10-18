/**
 * FROZEN CONTRACT (Phase 0). Structured JSON logging with pino.
 *
 * - One root logger per process; one child per request carrying `traceId`.
 * - Caregiver notes, anchors, person names and request bodies are redacted
 *   at any depth we know about. Log ids, counts, timings and phases, not content.
 * - No transports (serverless-friendly: plain JSON to stdout).
 *
 * Server-only. Never import from client components.
 */
import { nanoid } from "nanoid";
import pino from "pino";
import type { Logger } from "pino";

import { getConfig } from "@/lib/config";

export type { Logger };

/** Field names whose values are personal or caregiver-provided. */
const SENSITIVE_KEYS = [
  "notes",
  "anchors",
  "person",
  "displayName",
  "name",
  "birthPlace",
  "prompt",
  "input",
  "body",
  "apiKey",
  "authorization",
  "x-api-key",
  "token",
];

/** pino redact paths: the key at top level and up to two levels deep. */
export const REDACT_PATHS = SENSITIVE_KEYS.flatMap((k) => {
  const key = /^[a-zA-Z_$][\w$]*$/.test(k) ? k : `["${k}"]`;
  const dotted = key.startsWith("[") ? key : `.${key}`;
  return [key, `*${dotted}`, `*.*${dotted}`];
});

let root: Logger | undefined;

export function getLogger(): Logger {
  root ??= pino({
    level: getConfig().logLevel,
    base: { app: "rekindle" },
    redact: { paths: REDACT_PATHS, censor: "[redacted]" },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
  });
  return root;
}

export function newTraceId(): string {
  return nanoid(12);
}

/** Child logger for one request. Pass the trace id on to every port call. */
export function createRequestLogger(traceId: string = newTraceId(), bindings: Record<string, string> = {}): Logger {
  return getLogger().child({ traceId, ...bindings });
}
