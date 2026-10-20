import { describe, expect, it, vi } from "vitest";

import { MemoryCache } from "@/lib/adapters/cache";
import type { Fetcher, GeminiTtsConfig } from "@/lib/adapters/tts/gemini";
import { GeminiTts, pickVoice, VOICE_BY_LANG, wrapAsWav } from "@/lib/adapters/tts/gemini";
import { TtsError } from "@/lib/ports/tts";

import { recordingLogger, testCtx } from "./helpers";

const config: GeminiTtsConfig = {
  apiKey: "test-key-123456",
  model: "gemini-2.5-flash-preview-tts",
  timeoutMs: 2_000,
  maxRetries: 1,
  cacheTtlSeconds: 60,
};
const noSleep = async () => {};

/** Build an eight-byte PCM-ish fake and its base64 representation. */
const PCM = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);
const PCM_B64 = Buffer.from(PCM).toString("base64");

function okResponse(mimeType = "audio/L16;codec=pcm;rate=24000", data = PCM_B64): Response {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ inlineData: { mimeType, data } }] } }],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function errorResponse(status: number, body = ""): Response {
  return new Response(body || JSON.stringify({ error: { code: status, message: "err" } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("pickVoice", () => {
  it("maps short lang subtags to a pinned voice", () => {
    expect(pickVoice("it-IT")).toBe(VOICE_BY_LANG.it);
    expect(pickVoice("ar")).toBe(VOICE_BY_LANG.ar);
    expect(pickVoice("fr-FR")).toBe(VOICE_BY_LANG.fr);
  });

  it("falls back to the default voice for an unknown lang", () => {
    expect(pickVoice("zz")).toBeTruthy();
  });
});

describe("wrapAsWav", () => {
  it("prefixes raw PCM with a 44-byte RIFF/WAVE header and the right sample rate", () => {
    const wav = wrapAsWav(PCM, "audio/L16;codec=pcm;rate=24000");
    expect(wav.byteLength).toBe(44 + PCM.byteLength);
    const header = new TextDecoder().decode(wav.slice(0, 4));
    expect(header).toBe("RIFF");
    const format = new TextDecoder().decode(wav.slice(8, 12));
    expect(format).toBe("WAVE");
    // Sample rate at offset 24 (little-endian u32)
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    expect(view.getUint32(24, true)).toBe(24000);
    // Channels = 1 at offset 22
    expect(view.getUint16(22, true)).toBe(1);
    // Bits per sample = 16 at offset 34
    expect(view.getUint16(34, true)).toBe(16);
  });

  it("defaults to 24000 Hz when the mime type has no rate", () => {
    const wav = wrapAsWav(PCM, "audio/pcm");
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    expect(view.getUint32(24, true)).toBe(24000);
  });
});

describe("GeminiTts", () => {
  it("sends the correct payload shape and returns WAV-wrapped bytes", async () => {
    const fetcher = vi.fn<Fetcher>(async () => okResponse());
    const cache = new MemoryCache();
    const tts = new GeminiTts(config, cache, { fetcher, sleep: noSleep });
    const { logger, lines } = recordingLogger();

    const result = await tts.synthesize({ text: "Buongiorno Maria", lang: "it-IT" }, testCtx({ logger }));

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toContain("gemini-2.5-flash-preview-tts:generateContent");
    expect(String(url)).toContain("key=test-key-123456");
    const body = JSON.parse(String(init?.body));
    expect(body.generationConfig.responseModalities).toEqual(["AUDIO"]);
    expect(body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe(VOICE_BY_LANG.it);
    expect(body.contents[0].parts[0].text).toBe("Say: Buongiorno Maria");

    expect(result.mimeType).toBe("audio/wav");
    expect(result.cached).toBe(false);
    expect(result.provider).toBe("gemini");
    expect(result.audio.byteLength).toBe(44 + PCM.byteLength);
    // The audio bytes start with the RIFF header.
    expect(new TextDecoder().decode(result.audio.slice(0, 4))).toBe("RIFF");

    // Log never carries the prompt text.
    const logged = lines.join("\n");
    expect(logged).not.toContain("Buongiorno Maria");
    expect(logged).toContain("tts call");
  });

  it("caches by (text, lang, voice): a second call is a hit", async () => {
    const fetcher = vi.fn<Fetcher>(async () => okResponse());
    const cache = new MemoryCache();
    const tts = new GeminiTts(config, cache, { fetcher, sleep: noSleep });

    const first = await tts.synthesize({ text: "Hello", lang: "en" }, testCtx());
    expect(first.cached).toBe(false);
    const second = await tts.synthesize({ text: "Hello", lang: "en" }, testCtx());
    expect(second.cached).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    // Cache hits still return the WAV bytes.
    expect(second.mimeType).toBe("audio/wav");
    expect(second.audio.byteLength).toBeGreaterThan(44);
  });

  it("different text or lang bypass the cache", async () => {
    const fetcher = vi.fn<Fetcher>(async () => okResponse());
    const tts = new GeminiTts(config, new MemoryCache(), { fetcher, sleep: noSleep });

    await tts.synthesize({ text: "Hello", lang: "en" }, testCtx());
    await tts.synthesize({ text: "Hola", lang: "en" }, testCtx());
    await tts.synthesize({ text: "Hello", lang: "it" }, testCtx());
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("maps a 401 to unauthorized, non-retryable", async () => {
    const fetcher = vi.fn<Fetcher>(async () => errorResponse(401));
    const tts = new GeminiTts(config, new MemoryCache(), { fetcher, sleep: noSleep });
    const err = await tts
      .synthesize({ text: "Hello", lang: "en" }, testCtx())
      .catch((e) => e as TtsError);
    expect(err).toBeInstanceOf(TtsError);
    expect((err as TtsError).code).toBe("unauthorized");
    expect((err as TtsError).retryable).toBe(false);
    // Non-retryable: only one request.
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("retries a 500 then succeeds", async () => {
    const fetcher = vi
      .fn<Fetcher>()
      .mockResolvedValueOnce(errorResponse(500))
      .mockResolvedValueOnce(okResponse());
    const tts = new GeminiTts(config, new MemoryCache(), { fetcher, sleep: noSleep });

    const result = await tts.synthesize({ text: "Hello", lang: "en" }, testCtx());
    expect(result.cached).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("maps 429 to rate_limited and honours Retry-After", async () => {
    const sleeper = vi.fn<(ms: number, signal?: AbortSignal) => Promise<void>>(async () => {});
    const fetcher = vi
      .fn<Fetcher>()
      .mockResolvedValueOnce(
        new Response("", { status: 429, headers: { "retry-after": "2" } }),
      )
      .mockResolvedValueOnce(okResponse());
    const tts = new GeminiTts({ ...config, maxRetries: 1 }, new MemoryCache(), { fetcher, sleep: sleeper });
    const result = await tts.synthesize({ text: "Hello", lang: "en" }, testCtx());
    expect(result.cached).toBe(false);
    // The adapter waits at least retry-after seconds (2000 ms) before the retry.
    const waited = sleeper.mock.calls.map((c) => c[0]);
    expect(waited.some((ms) => ms >= 2000)).toBe(true);
  });

  it("rejects a response with no audio part as invalid_response", async () => {
    const fetcher = vi.fn<Fetcher>(async () =>
      new Response(JSON.stringify({ candidates: [{ content: { parts: [] } }] }), { status: 200 }),
    );
    const tts = new GeminiTts({ ...config, maxRetries: 0 }, new MemoryCache(), { fetcher, sleep: noSleep });
    const err = await tts.synthesize({ text: "Hello", lang: "en" }, testCtx()).catch((e) => e as TtsError);
    expect((err as TtsError).code).toBe("invalid_response");
  });
});
