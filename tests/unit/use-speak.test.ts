import { describe, expect, it, vi } from "vitest";

import { getMessages } from "@/i18n";
import { fetchCloudTts } from "@/components/session/use-speak";

/**
 * `useSpeak` is now cloud-only: there is no browser-voice path to assert. We
 * cover `fetchCloudTts` directly here (the hook is thin React glue over this
 * function and HTMLAudioElement, which lives in the e2e spec).
 */

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
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.audio.provider).toBe("gemini");
      expect(result.audio.blob.size).toBe(3);
    }
  });

  it("maps 503 to the 'unavailable' error state", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ error: { code: "tts_unavailable" } }), { status: 503 }),
    );
    const result = await fetchCloudTts("hi", "en", fetcher);
    expect(result).toEqual({ ok: false, error: "unavailable" });
  });

  it("maps 429 to the 'rate_limited' error state", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ error: { code: "rate_limited" } }), { status: 429 }),
    );
    const result = await fetchCloudTts("hi", "en", fetcher);
    expect(result).toEqual({ ok: false, error: "rate_limited" });
  });

  it("maps other non-2xx statuses to the 'network' error state", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ error: { code: "internal" } }), { status: 500 }),
    );
    const result = await fetchCloudTts("hi", "en", fetcher);
    expect(result).toEqual({ ok: false, error: "network" });
  });

  it("maps a thrown fetch to the 'network' error state", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => {
      throw new Error("offline");
    });
    const result = await fetchCloudTts("hi", "en", fetcher);
    expect(result).toEqual({ ok: false, error: "network" });
  });
});

describe("listenErrors i18n copy", () => {
  it("en: differentiates rate_limited, network, and unavailable", () => {
    const t = getMessages("en").step.listenErrors;
    expect(t.unavailable).toBe("Voice unavailable right now.");
    expect(t.rate_limited).toBe("Taking a short rest; try again in a minute.");
    expect(t.network).toBe("Voice offline; retry when the connection is back.");
  });
  it("it: all three branches present", () => {
    const t = getMessages("it").step.listenErrors;
    expect(t.unavailable).toContain("Voce");
    expect(t.rate_limited).toContain("riposando");
    expect(t.network).toContain("offline");
  });
  it("fr: all three branches present", () => {
    const t = getMessages("fr").step.listenErrors;
    expect(t.unavailable).toContain("Voix");
    expect(t.rate_limited).toContain("répit");
    expect(t.network).toContain("hors ligne");
  });
});
