/**
 * POST /api/tts: server-side TTS fallback for the listen button.
 *
 * Called only when the viewer's browser has no Web Speech voice for the
 * target language (the client checks `speechSynthesis.getVoices()` first and
 * only reaches here on a miss). Returns audio bytes with a 24h browser cache
 * header; the server cache is content-addressed and memory-only
 * (`sensitive: true`) because the prompt text contains the person's
 * displayName.
 *
 * On "no key" / mock mode the route returns 503 with a clear JSON body so
 * the client falls back to the browser's default voice instead of showing a
 * blank error.
 */
import { z } from "zod";

import { clientKey, jsonError, parseJsonBody, rateLimited, rateLimiters } from "@/app/api/_lib/http";
import { getAgentDepsAsync } from "@/lib/composition";
import { createRequestLogger, newTraceId } from "@/lib/logger";
import { TtsError } from "@/lib/ports/tts";

// Node.js runtime is the default (and the only option with cacheComponents).
// TTS is a sibling LLM-ish call: a few seconds budget is plenty, well under
// the agent's 60s window.
export const maxDuration = 15;

const TtsRequestBody = z.object({
  text: z.string().min(1).max(1000),
  lang: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/u),
});

export async function POST(request: Request): Promise<Response> {
  const traceId = newTraceId();
  const logger = createRequestLogger(traceId, { route: "tts" });
  const limited = rateLimited(rateLimiters.tts, request, traceId);
  if (limited) {
    logger.warn({ status: 429 }, "tts request rate limited");
    return limited;
  }
  const parsed = await parseJsonBody(request, TtsRequestBody, traceId);
  if (!parsed.ok) {
    logger.info({ status: parsed.response.status }, "tts request rejected");
    return parsed.response;
  }
  let deps;
  try {
    deps = await getAgentDepsAsync();
  } catch (error) {
    logger.error({ err: error instanceof Error ? error.name : typeof error }, "agent dependencies unavailable");
    return jsonError(500, "internal", "The TTS service is not configured correctly.", traceId);
  }
  const tts = deps.tts;
  if (!tts || tts.mode === "mock") {
    logger.info({ provider: tts?.provider ?? "none" }, "tts unavailable (no key)");
    // 503 so the client falls back to the browser's default voice.
    return Response.json(
      { error: { code: "tts_unavailable", message: "Cloud TTS is not configured in this environment." } },
      { status: 503, headers: { "x-trace-id": traceId, "cache-control": "no-store", "x-tts-provider": "mock" } },
    );
  }
  try {
    const result = await tts.synthesize(
      { text: parsed.data.text, lang: parsed.data.lang },
      { traceId, logger, signal: request.signal },
    );
    logger.info(
      {
        lang: parsed.data.lang,
        provider: result.provider,
        model: result.model,
        cached: result.cached,
        latencyMs: result.latencyMs,
        bytes: result.audio.byteLength,
        clientKey: clientKey(request).slice(0, 2) + "...",
      },
      "tts call ok",
    );
    // Serve the raw bytes. Content-addressed, so a 24h public cache is safe:
    // the same (text, lang) always yields the same bytes.
    return new Response(new Uint8Array(result.audio), {
      status: 200,
      headers: {
        "content-type": result.mimeType,
        "content-length": String(result.audio.byteLength),
        "cache-control": "public, max-age=86400",
        "x-trace-id": traceId,
        "x-tts-cached": result.cached ? "true" : "false",
        "x-tts-provider": result.provider,
      },
    });
  } catch (error) {
    if (error instanceof TtsError) {
      logger.warn({ code: error.code, retryable: error.retryable }, "tts call failed");
      const status = statusFor(error);
      const headers: Record<string, string> = { "x-trace-id": traceId, "cache-control": "no-store", "x-tts-provider": tts.provider };
      if (status === 429 && error.retryAfterSeconds) headers["retry-after"] = String(error.retryAfterSeconds);
      return Response.json({ error: { code: error.code, message: userMessage(error) } }, { status, headers });
    }
    logger.error({ err: error instanceof Error ? error.name : typeof error }, "tts call errored");
    return jsonError(500, "internal", "The TTS service failed.", traceId);
  }
}

function statusFor(error: TtsError): number {
  switch (error.code) {
    case "unauthorized":
      return 503;
    case "rate_limited":
      return 429;
    case "timeout":
      return 504;
    case "bad_request":
      return 400;
    case "invalid_response":
    case "unavailable":
    default:
      return 503;
  }
}

function userMessage(error: TtsError): string {
  switch (error.code) {
    case "rate_limited":
      return "The TTS service is rate limited. Please try again shortly.";
    case "timeout":
      return "The TTS service took too long to respond.";
    case "bad_request":
      return "The TTS request was rejected.";
    default:
      return "The TTS service is unavailable.";
  }
}
