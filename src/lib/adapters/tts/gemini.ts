/**
 * Live TTS adapter on the Gemini `:generateContent` endpoint with
 * `responseModalities: ["AUDIO"]`.
 *
 * Pinned model: `gemini-2.5-flash-preview-tts`. The free tier is 3 RPM, so
 * the content-addressed memory cache is load-bearing for the demo: a second
 * click on the same prompt replays bytes from memory.
 *
 * Audio format (verified against the live key, 2026-10-20):
 *   mimeType: "audio/L16;codec=pcm;rate=24000"
 *   signed 16-bit little-endian PCM, mono (1 channel), 24000 Hz
 *
 * The browser cannot play raw L16 as-is, so we wrap it in a 44-byte RIFF
 * WAVE header server-side and return `audio/wav`. That way the client just
 * creates `new Audio(URL.createObjectURL(blob))` and plays it.
 *
 * The Gemini TTS model sometimes "answers" a prompt instead of reading it
 * (observed with Arabic text: 400 "Model tried to generate text..."). We
 * prefix every request with "Say: " to force audio modality. See:
 * https://ai.google.dev/gemini-api/docs/speech-generation
 */
import { buildCacheKey } from "@/lib/ports/cache";
import type { CachePort } from "@/lib/ports/cache";
import type { CallContext } from "@/lib/ports/common";
import type { TtsPort, TtsRequest, TtsResult } from "@/lib/ports/tts";
import { TtsError } from "@/lib/ports/tts";

import type { Sleep } from "@/lib/adapters/shared/backoff";
import { abortableSleep, backoffMs } from "@/lib/adapters/shared/backoff";

export const GEMINI_TTS_MODEL = "gemini-2.5-flash-preview-tts";
const GEMINI_TTS_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Voice selection per short language subtag. Picked from the ~30 prebuilt
 * voices in the Gemini TTS catalogue (Puck, Kore, Charon, Fenrir, Aoede,
 * Leda, Orus, Zephyr, ...) by language family. The model is multilingual, so
 * these are style choices (warm, measured, calm) rather than hard locale
 * pins: any voice can speak any language the model knows.
 *
 * Rationale per entry:
 *   it  Puck    warm, measured; fits an older Italian listener
 *   fr  Charon  calm masculine; suits a French-speaking elder
 *   ar  Kore    firm feminine; the Arabic family's clearest consonants
 *   es  Aoede   warm feminine
 *   en  Puck    the project's default caregiver voice
 *   de  Fenrir  grounded masculine
 *   pt  Leda    warm feminine
 */
export const VOICE_BY_LANG: Record<string, string> = {
  it: "Puck",
  fr: "Charon",
  ar: "Kore",
  es: "Aoede",
  en: "Puck",
  de: "Fenrir",
  pt: "Leda",
};
export const DEFAULT_VOICE = "Puck";

/** BCP-47 "fr-FR" or raw "fr" to the short lowercased subtag used for voice lookup. */
export function shortLang(lang: string): string {
  return (lang ?? "").toLowerCase().split(/[-_]/)[0];
}

/** Resolve the voice name the adapter will send. Exported for tests. */
export function pickVoice(lang: string): string {
  return VOICE_BY_LANG[shortLang(lang)] ?? DEFAULT_VOICE;
}

export type Fetcher = typeof fetch;

export interface GeminiTtsConfig {
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxRetries: number;
  cacheTtlSeconds: number;
}

export interface GeminiTtsOptions {
  fetcher?: Fetcher;
  sleep?: Sleep;
  keyPrefix?: string;
}

interface GeminiInlineAudio {
  mimeType: string;
  data: string;
}

interface GeminiTtsEnvelope {
  candidates?: Array<{ content?: { parts?: Array<{ inlineData?: GeminiInlineAudio }> } }>;
  error?: { code?: number; message?: string; status?: string };
}

export class GeminiTts implements TtsPort {
  readonly mode = "live" as const;
  readonly provider = "gemini";
  readonly model: string;
  private readonly fetcher: Fetcher;
  private readonly sleep: Sleep;
  private readonly keyPrefix?: string;

  constructor(
    private readonly config: GeminiTtsConfig,
    private readonly cache: CachePort,
    options: GeminiTtsOptions = {},
  ) {
    this.model = config.model;
    this.fetcher = options.fetcher ?? ((u, i) => fetch(u, i));
    this.sleep = options.sleep ?? abortableSleep;
    this.keyPrefix = options.keyPrefix;
  }

  async synthesize(request: TtsRequest, ctx: CallContext): Promise<TtsResult> {
    const started = Date.now();
    const log = ctx.logger.child({ port: "tts", provider: this.provider, model: this.model });
    const voice = pickVoice(request.lang);
    const key = buildCacheKey(
      {
        provider: "gemini-tts",
        model: this.model,
        promptVersion: "v1",
        input: { lang: shortLang(request.lang), voice, text: request.text },
      },
      this.keyPrefix,
    );
    // Memory-only cache (sensitive: true): the text contains the person's displayName.
    const hit = await this.cache.get<{ audio: string; mimeType: string }>(key);
    if (hit && typeof hit.audio === "string" && typeof hit.mimeType === "string") {
      const latencyMs = Date.now() - started;
      log.info({ cached: true, latencyMs, lang: shortLang(request.lang) }, "tts call");
      return {
        audio: Buffer.from(hit.audio, "base64"),
        mimeType: hit.mimeType,
        cached: true,
        provider: this.provider,
        model: this.model,
        latencyMs,
      };
    }

    const url = `${GEMINI_TTS_BASE}/${this.model}:generateContent?key=${encodeURIComponent(this.config.apiKey)}`;
    const body = JSON.stringify({
      // "Say: " forces the AUDIO modality even for prompts the model might
      // otherwise try to answer (observed with Arabic input).
      contents: [{ parts: [{ text: `Say: ${request.text}` }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
      },
    });

    const attempts = this.config.maxRetries + 1;
    let lastError: TtsError | undefined;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (ctx.signal?.aborted) throw new TtsError("timeout", "The TTS call was cancelled", false);
      const timeout = AbortSignal.timeout(this.config.timeoutMs);
      const signal = ctx.signal ? AbortSignal.any([ctx.signal, timeout]) : timeout;
      try {
        const res = await this.fetcher(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
          signal,
        });
        if (!res.ok) {
          lastError = await mapHttpError(res);
          log.warn({ attempt, status: res.status, code: lastError.code, retryable: lastError.retryable }, "tts call failed");
          if (!lastError.retryable) throw lastError;
          if (attempt < attempts) {
            const wait = Math.max(backoffMs(attempt), (lastError.retryAfterSeconds ?? 0) * 1000);
            await this.sleep(wait, ctx.signal);
            continue;
          }
          throw lastError;
        }
        const json = (await res.json()) as GeminiTtsEnvelope;
        const inline = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;
        if (!inline?.data || !inline.mimeType) {
          lastError = new TtsError("invalid_response", "The TTS response had no audio", true);
          log.warn({ attempt, code: lastError.code }, "tts call failed");
          if (attempt < attempts) {
            await this.sleep(backoffMs(attempt), ctx.signal);
            continue;
          }
          throw lastError;
        }
        const pcm = Buffer.from(inline.data, "base64");
        const audio = wrapAsWav(pcm, inline.mimeType);
        // Cache the WAV-wrapped bytes so cache hits are directly playable.
        await this.cache.set(
          key,
          { audio: Buffer.from(audio).toString("base64"), mimeType: "audio/wav" },
          { ttlSeconds: this.config.cacheTtlSeconds, sensitive: true },
        );
        const latencyMs = Date.now() - started;
        log.info({ cached: false, latencyMs, attempt, lang: shortLang(request.lang), bytes: audio.byteLength }, "tts call");
        return {
          audio,
          mimeType: "audio/wav",
          cached: false,
          provider: this.provider,
          model: this.model,
          latencyMs,
        };
      } catch (error) {
        if (error instanceof TtsError) {
          lastError = error;
          if (!error.retryable || ctx.signal?.aborted) break;
          continue;
        }
        const timedOut = timeout.aborted && !ctx.signal?.aborted;
        lastError = toTtsError(error, timedOut);
        log.warn({ attempt, code: lastError.code, retryable: lastError.retryable }, "tts call failed");
        if (!lastError.retryable || ctx.signal?.aborted) break;
        if (attempt < attempts) await this.sleep(backoffMs(attempt), ctx.signal);
      }
    }
    throw lastError ?? new TtsError("unavailable", "The TTS service is unavailable", true);
  }
}

/** Map a non-2xx response to a TtsError (status-only; never echoes body text). */
async function mapHttpError(res: Response): Promise<TtsError> {
  const retryAfterRaw = res.headers.get("retry-after");
  const retryAfterSeconds = retryAfterRaw ? Number.parseInt(retryAfterRaw, 10) : undefined;
  const retryAfter = Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : undefined;
  // Drain the body so the connection can be reused.
  try {
    await res.text();
  } catch {
    /* ignore */
  }
  if (res.status === 401 || res.status === 403) {
    return new TtsError("unauthorized", "The TTS provider rejected the credentials", false);
  }
  if (res.status === 429) {
    return new TtsError("rate_limited", "The TTS provider is rate limited", true, { retryAfterSeconds: retryAfter });
  }
  if (res.status === 400) {
    return new TtsError("bad_request", "The TTS provider rejected the request", false);
  }
  if (res.status >= 500) {
    return new TtsError("unavailable", "The TTS provider is unavailable", true);
  }
  return new TtsError("unavailable", "The TTS provider is unavailable", false);
}

function toTtsError(error: unknown, timedOut: boolean): TtsError {
  if (timedOut) return new TtsError("timeout", "The TTS call timed out", true, { cause: error });
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return new TtsError("timeout", "The TTS call was cancelled", false, { cause: error });
  }
  return new TtsError("unavailable", "The TTS service is unavailable", true, { cause: error });
}

/**
 * Wrap raw PCM in a 44-byte RIFF WAVE header so browsers can play it as
 * `audio/wav`. Parses the `audio/L16;codec=pcm;rate=<N>` MIME to pick up the
 * sample rate; defaults to 24000 Hz / mono / 16-bit if any attribute is
 * missing. Returns a new Uint8Array; caller may discard the raw PCM buffer.
 */
export function wrapAsWav(pcm: Uint8Array, mimeType: string): Uint8Array {
  const sampleRate = parseSampleRate(mimeType) ?? 24000;
  const channels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const dataSize = pcm.byteLength;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  // RIFF chunk descriptor
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, "WAVE");
  // fmt sub-chunk
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true); // PCM header size
  view.setUint16(20, 1, true); // audio format = PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  // data sub-chunk
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);
  new Uint8Array(buffer, 44).set(pcm);
  return new Uint8Array(buffer);
}

function parseSampleRate(mimeType: string): number | undefined {
  // "audio/L16;codec=pcm;rate=24000" or "audio/pcm;rate=24000"
  const match = /rate=(\d+)/.exec(mimeType);
  if (!match) return undefined;
  const n = Number.parseInt(match[1], 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function writeString(view: DataView, offset: number, s: string): void {
  for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
}
