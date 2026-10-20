/**
 * FROZEN CONTRACT (added 2026-10-20, pending integrator sign-off: see TODO.md).
 *
 * Text-to-speech port. Thin by design: one method, no streaming, no voice-id
 * negotiation. The adapter picks the voice from `lang` (a BCP-47 tag or short
 * subtag) because voice-naming is provider-specific. Audio comes back as a
 * decoded byte buffer plus a MIME type so the API route can forward it to
 * the browser without re-encoding.
 *
 * Server-only. The browser's own Web Speech API is the fast default; this
 * port is the fallback when the viewer's device has no voice for the target
 * language. Adapters: src/lib/adapters/tts/{gemini,mock}.ts (W-CORE).
 */
import type { CallContext, ProviderMode } from "@/lib/ports/common";

export interface TtsRequest {
  /** The sentence to synthesize. Short, under 1000 chars. */
  text: string;
  /** BCP-47 (e.g. "ar", "fr-FR"). The adapter maps this to a voice. */
  lang: string;
}

export interface TtsResult {
  /** Playable audio bytes (adapters wrap raw PCM in a container when needed). */
  audio: Uint8Array;
  /** MIME type for the Content-Type header, e.g. "audio/wav" or "audio/mpeg". */
  mimeType: string;
  /** True when served from cache; the route surfaces this as `x-tts-cached`. */
  cached: boolean;
  /** Adapter id for diagnostics, e.g. "gemini", "mock". */
  provider: string;
  /** Pinned model id used, e.g. "gemini-2.5-flash-preview-tts" or "mock-tts". */
  model: string;
  latencyMs: number;
}

export interface TtsPort {
  readonly mode: ProviderMode;
  readonly provider: string;
  readonly model: string;
  /**
   * Synthesize `text` in `lang`. Throws PortError("tts" is NOT a valid port
   * code in the frozen common.ts, so adapters raise PortError("llm", ...)
   * with a message that identifies the TTS path, OR a dedicated TtsError
   * (see adapter notes). The route handler catches both.
   */
  synthesize(request: TtsRequest, ctx: CallContext): Promise<TtsResult>;
}

/**
 * TTS-specific error so adapters do not have to abuse the frozen PortError
 * union. Shape mirrors PortError for symmetric handling at the route.
 */
export class TtsError extends Error {
  constructor(
    public readonly code: "unavailable" | "rate_limited" | "timeout" | "invalid_response" | "unauthorized" | "bad_request",
    message: string,
    public readonly retryable: boolean,
    options?: { cause?: unknown; retryAfterSeconds?: number },
  ) {
    super(message, options);
    this.name = "TtsError";
    this.retryAfterSeconds = options?.retryAfterSeconds;
  }
  readonly retryAfterSeconds?: number;
}
