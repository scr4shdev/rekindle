import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchCloudTts, hasVoiceForLang, pickVoice, Speaker, shortLang } from "@/components/session/use-speak";

/**
 * Minimal shapes that stand in for the browser APIs we rely on. Tests must
 * never pull real audio or depend on the host system's voices.
 */
type FakeUtterance = {
  text: string;
  lang: string;
  voice: unknown;
  rate: number;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};

class FakeUtteranceCtor {
  text: string;
  lang = "";
  voice: unknown = null;
  rate = 1;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

function makeSynth(voices: Array<{ lang: string; name: string; default?: boolean }>) {
  const spoken: FakeUtterance[] = [];
  return {
    spoken,
    cancel: vi.fn(),
    speak: vi.fn((u: unknown) => {
      spoken.push(u as FakeUtterance);
    }),
    getVoices: vi.fn(() => voices),
  };
}

const AR_VOICES = [
  { lang: "en-US", name: "English (US)" },
  { lang: "ar-SA", name: "Arabic (Saudi Arabia)", default: true },
  { lang: "ar-EG", name: "Arabic (Egypt)" },
];

describe("use-speak helpers", () => {
  it("shortLang normalises BCP 47 tags", () => {
    expect(shortLang("ar-SA")).toBe("ar");
    expect(shortLang("EN_us")).toBe("en");
    expect(shortLang("")).toBe("");
  });

  it("hasVoiceForLang matches by two-letter prefix", () => {
    expect(hasVoiceForLang(AR_VOICES, "ar")).toBe(true);
    expect(hasVoiceForLang(AR_VOICES, "ar-MA")).toBe(true);
    expect(hasVoiceForLang(AR_VOICES, "it")).toBe(false);
    expect(hasVoiceForLang([], "ar")).toBe(false);
  });

  it("pickVoice prefers a default voice for the language", () => {
    const picked = pickVoice(AR_VOICES, "ar");
    expect(picked?.name).toBe("Arabic (Saudi Arabia)");
  });
});

describe("Speaker", () => {
  let synth: ReturnType<typeof makeSynth>;
  let speaker: Speaker;

  beforeEach(() => {
    synth = makeSynth(AR_VOICES);
    speaker = new Speaker({ synthesis: synth, Utterance: FakeUtteranceCtor as unknown as typeof SpeechSynthesisUtterance });
    speaker.refreshVoices();
  });

  it("hasVoiceFor('ar') is true when voices include ar-SA or ar-EG", () => {
    expect(speaker.hasVoiceFor("ar")).toBe(true);
    expect(speaker.hasVoiceFor("ar-MA")).toBe(true);
    expect(speaker.hasVoiceFor("fr")).toBe(false);
  });

  it("speak cancels any prior utterance and attaches the matching voice", () => {
    speaker.speak("مرحبا", "ar-MA");
    expect(synth.cancel).toHaveBeenCalledOnce();
    expect(synth.speak).toHaveBeenCalledOnce();
    const sent = synth.spoken[0];
    expect(sent.lang).toBe("ar-MA");
    expect(sent.rate).toBe(0.95);
    expect((sent.voice as { name: string }).name).toBe("Arabic (Saudi Arabia)");
  });

  it("isPlaying toggles on onstart and onend", () => {
    speaker.speak("مرحبا", "ar-SA");
    const sent = synth.spoken[0];
    expect(speaker.isPlaying).toBe(false);
    sent.onstart?.();
    expect(speaker.isPlaying).toBe(true);
    sent.onend?.();
    expect(speaker.isPlaying).toBe(false);
  });

  it("speak with no matching voice leaves voice unset so the browser default fires", () => {
    speaker.speak("Ciao", "it-IT");
    const sent = synth.spoken[0];
    expect(sent.voice).toBeNull();
    expect(sent.lang).toBe("it-IT");
  });

  it("setPlaying tracks the cloud playback source and emits to subscribers", () => {
    const notify = vi.fn();
    speaker.subscribe(notify);
    expect(speaker.source).toBeNull();
    speaker.setPlaying(true, "gemini");
    expect(speaker.isPlaying).toBe(true);
    expect(speaker.source).toBe("gemini");
    expect(notify).toHaveBeenCalled();
    speaker.setPlaying(false, "gemini");
    expect(speaker.isPlaying).toBe(false);
    expect(speaker.source).toBe("gemini");
  });
});

describe("fetchCloudTts", () => {
  it("POSTs {text, lang} to /api/tts and returns the blob on 200", async () => {
    const audioBlob = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" });
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(audioBlob, {
        status: 200,
        headers: { "content-type": "audio/wav", "x-tts-provider": "gemini" },
      }),
    );
    const result = await fetchCloudTts("مرحبا فاطمة", "ar", fetcher);
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe("/api/tts");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(String(init?.body));
    expect(body).toEqual({ text: "مرحبا فاطمة", lang: "ar" });
    expect(result?.provider).toBe("gemini");
    expect(result?.blob.size).toBe(3);
  });

  it("returns null on 503 so the hook can fall back to the browser default voice", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ error: { code: "tts_unavailable" } }), { status: 503 }),
    );
    const result = await fetchCloudTts("hi", "en", fetcher);
    expect(result).toBeNull();
  });

  it("returns null on a network error", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => {
      throw new Error("offline");
    });
    const result = await fetchCloudTts("hi", "en", fetcher);
    expect(result).toBeNull();
  });
});
