/**
 * Shared helpers for the API route handlers: pre-stream validation (JSON
 * errors per docs/api.md) and the NDJSON streaming response. Server-only.
 */
import type { z } from "zod";

import { NDJSON_CONTENT_TYPE, toNdjsonStream } from "@/lib/domain/ndjson";
import type { AgentEvent } from "@/lib/domain/types";

/** Request body limit (docs/api.md). */
export const MAX_BODY_BYTES = 64 * 1024;

export type ApiErrorCode = "invalid_input" | "payload_too_large" | "unsupported_media_type" | "internal";

export function jsonError(
  status: number,
  code: ApiErrorCode,
  message: string,
  traceId: string,
  issues?: Array<{ path: string; message: string }>,
): Response {
  return Response.json(
    { error: { code, message, ...(issues ? { issues } : {}) } },
    { status, headers: { "x-trace-id": traceId, "cache-control": "no-store" } },
  );
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
