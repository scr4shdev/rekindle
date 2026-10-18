/**
 * FROZEN CONTRACT (Phase 0). NDJSON framing for AgentEvent streams.
 * Shared by the API routes (encode) and the UI (decode). No Node APIs.
 */
import { AgentEvent } from "@/lib/domain/types";
import type { AgentEventPayload } from "@/lib/domain/types";

export const NDJSON_CONTENT_TYPE = "application/x-ndjson; charset=utf-8";

/** Serialize one event as a single NDJSON line (with trailing newline). */
export function encodeEvent(event: AgentEvent): string {
  return `${JSON.stringify(event)}\n`;
}

/**
 * Stamps payloads with `seq` and `t` (ms since creation) in emission order.
 * Use one stamper per stream.
 */
export function createEventStamper(now: () => number = () => Date.now()) {
  const start = now();
  let seq = 0;
  return (payload: AgentEventPayload): AgentEvent =>
    AgentEvent.parse({ ...payload, seq: seq++, t: Math.max(0, now() - start) });
}

export class NdjsonParseError extends Error {
  constructor(
    message: string,
    public readonly line: string,
  ) {
    super(message);
    this.name = "NdjsonParseError";
  }
}

/** Parse and validate one NDJSON line. Throws NdjsonParseError on bad JSON or schema mismatch. */
export function decodeEventLine(line: string): AgentEvent {
  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch {
    throw new NdjsonParseError("Invalid JSON line in event stream", line);
  }
  const result = AgentEvent.safeParse(json);
  if (!result.success) throw new NdjsonParseError(`Invalid AgentEvent: ${result.error.message}`, line);
  return result.data;
}

/** Decode a streamed NDJSON body (e.g. `response.body`) into validated AgentEvents. */
export async function* readEventStream(body: ReadableStream<Uint8Array>): AsyncGenerator<AgentEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) yield decodeEventLine(line);
        newline = buffer.indexOf("\n");
      }
    }
    const rest = (buffer + decoder.decode()).trim();
    if (rest) yield decodeEventLine(rest);
  } finally {
    reader.releaseLock();
  }
}

/** Build a streaming NDJSON body from an async iterable of events (for route handlers). */
export function toNdjsonStream(events: AsyncIterable<AgentEvent>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const iterator = events[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await iterator.next();
      if (done) controller.close();
      else controller.enqueue(encoder.encode(encodeEvent(value)));
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}
