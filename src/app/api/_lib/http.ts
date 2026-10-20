/**
 * Shared helpers for the API route handlers: pre-stream validation (JSON
 * errors per docs/api.md) and the NDJSON streaming response. Server-only.
 */
import type { z } from "zod";

import { NDJSON_CONTENT_TYPE, toNdjsonStream } from "@/lib/domain/ndjson";
import type { AgentEvent } from "@/lib/domain/types";

/** Request body limit (docs/api.md). */
export const MAX_BODY_BYTES = 64 * 1024;

export type ApiErrorCode = "invalid_input" | "payload_too_large" | "unsupported_media_type" | "rate_limited" | "internal";

export function jsonError(
  status: number,
  code: ApiErrorCode,
  message: string,
  traceId: string,
  issues?: Array<{ path: string; message: string }>,
  headers: Record<string, string> = {},
): Response {
  return Response.json(
    { error: { code, message, ...(issues ? { issues } : {}) } },
    { status, headers: { "x-trace-id": traceId, "cache-control": "no-store", ...headers } },
  );
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

/** Limits per client IP: a burst of `capacity` requests, refilled at `refillPerMinute`. */
export const RATE_LIMITS = {
  // Session: judges reload hard and often. A short burst (reloads, back-navigation,
  // dev-tools "disable cache" refreshes) is normal, not abuse: give it headroom
  // and refill fast enough that a steady human cadence never hits the limit.
  session: { capacity: 20, refillPerMinute: 30 },
  replan: { capacity: 30, refillPerMinute: 30 },
  // TTS is a cheap, cacheable fallback that fires on every unsupported-language
  // step card the viewer taps. 60/min keeps a demo run comfortably clear of the
  // limit while still blocking a loop.
  tts: { capacity: 60, refillPerMinute: 60 },
} as const;
/** Clients tracked per instance; the least recently seen are forgotten first. */
export const RATE_LIMIT_MAX_CLIENTS = 5_000;

/**
 * Best-effort in-memory token bucket per client IP. On serverless each warm
 * instance has its own buckets, so this caps bursts per instance; it is not a
 * global quota. IPs stay in process memory only and are never logged.
 */
export class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();

  constructor(
    private readonly limit: { capacity: number; refillPerMinute: number },
    private readonly now: () => number = Date.now,
  ) {}

  /** Take one token; returns 0 when allowed, else the seconds to wait. */
  take(client: string): number {
    const now = this.now();
    const perMs = this.limit.refillPerMinute / 60_000;
    const prev = this.buckets.get(client) ?? { tokens: this.limit.capacity, at: now };
    const tokens = Math.min(this.limit.capacity, prev.tokens + (now - prev.at) * perMs);
    this.buckets.delete(client);
    if (tokens < 1) {
      this.buckets.set(client, { tokens, at: now });
      return Math.max(1, Math.ceil((1 - tokens) / perMs / 1000));
    }
    this.buckets.set(client, { tokens: tokens - 1, at: now });
    while (this.buckets.size > RATE_LIMIT_MAX_CLIENTS) this.buckets.delete(this.buckets.keys().next().value!);
    return 0;
  }

  reset(): void {
    this.buckets.clear();
  }
}

export const rateLimiters = {
  session: new RateLimiter(RATE_LIMITS.session),
  replan: new RateLimiter(RATE_LIMITS.replan),
  tts: new RateLimiter(RATE_LIMITS.tts),
};

/** Client key from the proxy headers (Vercel sets x-forwarded-for). */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}

/** The documented 429 JSON (before streaming starts), or undefined when allowed. */
export function rateLimited(limiter: RateLimiter, request: Request, traceId: string): Response | undefined {
  const wait = limiter.take(clientKey(request));
  if (wait === 0) return undefined;
  return jsonError(429, "rate_limited", "Too many requests. Please wait a moment and try again.", traceId, undefined, {
    "retry-after": String(wait),
  });
}

class BodyTooLarge extends Error {}

/** Read the body as text, refusing more than `limit` bytes without buffering all of it. */
async function readLimited(request: Request, limit: number): Promise<string> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > limit) throw new BodyTooLarge();
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new BodyTooLarge();
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

export type Parsed<T> = { ok: true; data: T } | { ok: false; response: Response };

/** Validate content type, size, JSON and schema. Messages never echo submitted values. */
export async function parseJsonBody<S extends z.ZodType>(request: Request, schema: S, traceId: string): Promise<Parsed<z.infer<S>>> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().includes("application/json")) {
    return { ok: false, response: jsonError(415, "unsupported_media_type", "Send the request body as application/json.", traceId) };
  }
  let text: string;
  try {
    text = await readLimited(request, MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof BodyTooLarge) return { ok: false, response: jsonError(413, "payload_too_large", "Request body is too large (64 KB maximum).", traceId) };
    return { ok: false, response: jsonError(400, "invalid_input", "Request body could not be read.", traceId) };
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, response: jsonError(400, "invalid_input", "Request body is not valid JSON.", traceId) };
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    const issues = result.error.issues.slice(0, 20).map((i) => ({ path: i.path.map(String).join("."), message: i.message }));
    return { ok: false, response: jsonError(400, "invalid_input", "Request body is invalid.", traceId, issues) };
  }
  return { ok: true, data: result.data };
}

/** Stream AgentEvents as NDJSON (status 200 once streaming has started). */
export function ndjsonResponse(events: AsyncIterable<AgentEvent>, traceId: string): Response {
  return new Response(toNdjsonStream(events), {
    status: 200,
    headers: {
      "content-type": NDJSON_CONTENT_TYPE,
      "x-trace-id": traceId,
      "cache-control": "no-store, no-transform",
      // Ask proxies not to buffer the stream.
      "x-accel-buffering": "no",
    },
  });
}
