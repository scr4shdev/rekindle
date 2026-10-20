"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Cloud-only speak hook. The browser's Web Speech API is deliberately not used
 * here, even when it has a matching voice: on many devices the OS voice is
 * cranky or wrong, and the Gemini TTS adapter (`/api/tts`) gives a consistent,
 * natural read across every language we support. If Gemini is unreachable we
 * surface an honest error state instead of playing a worse voice.
 */

/** Where the current / last playback came from. Kept as a field for callers; the dual-source story is gone. */
export type SpeakSource = "gemini" | null;

/** Classified failure modes surfaced to the caller. */
export type SpeakError = "unavailable" | "rate_limited" | "network";

/** Fetch result shape used by the cloud-TTS call. */
export interface CloudAudio {
  blob: Blob;
  provider: string;
}

/** Result returned by `fetchCloudTts`: either the audio blob, or a classified error. */
export type CloudTtsResult =
  | { ok: true; audio: CloudAudio }
  | { ok: false; error: SpeakError };

function cacheKey(text: string, lang: string): string {
  return `${lang}:${text}`;
}

/**
 * Call `POST /api/tts` and return the audio blob, or a classified error on
 * failure. Exported for unit tests; the hook wires this to an
 * `HTMLAudioElement`.
 */
export async function fetchCloudTts(
  text: string,
  lang: string,
  fetcher: typeof fetch = fetch,
): Promise<CloudTtsResult> {
  let res: Response;
  try {
    res = await fetcher("/api/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, lang }),
    });
  } catch {
    return { ok: false, error: "network" };
  }
  if (!res.ok) {
    if (res.status === 503) return { ok: false, error: "unavailable" };
    if (res.status === 429) return { ok: false, error: "rate_limited" };
    return { ok: false, error: "network" };
  }
  const blob = await res.blob();
  return { ok: true, audio: { blob, provider: res.headers.get("x-tts-provider") ?? "gemini" } };
}

export interface UseSpeakApi {
  speak: (text: string, lang: string) => void;
  stop: () => void;
  isPlaying: boolean;
  isLoading: boolean;
  error: SpeakError | null;
  /** Which path produced the current / last playback. Always "gemini" or null. */
  source: SpeakSource;
}

/**
 * Hook that drives cloud-only playback for the Listen button. Lazy-initialised
 * on the client (SSR-safe): on the server all state is inert.
 *
 * Flow for every `speak(text, lang)` call:
 *  1. Cancel any in-flight playback.
 *  2. Set `isLoading` true and `error` null.
 *  3. Fetch `/api/tts` (or reuse an in-session blob cache).
 *  4. On success, play the returned WAV through an `HTMLAudioElement` and
 *     flip `isPlaying` on `onplay`, off on `onended` / `onerror`.
 *  5. On failure, set `error` to one of "unavailable" | "rate_limited" |
 *     "network". No OS voice fallback.
 */
export function useSpeak(): UseSpeakApi {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobCacheRef = useRef<Map<string, CloudAudio>>(new Map());
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<SpeakError | null>(null);
  const [source, setSource] = useState<SpeakSource>(null);

  useEffect(() => {
    return () => {
      // Tear down any in-flight cloud playback on unmount.
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.src = "";
      }
      audioRef.current = null;
    };
  }, []);

  const stop = () => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.src = "";
    }
    audioRef.current = null;
    setIsPlaying(false);
    setSource(null);
  };

  const playBlob = (audio: CloudAudio) => {
    const url = URL.createObjectURL(audio.blob);
    const el = new Audio(url);
    audioRef.current = el;
    el.addEventListener(
      "play",
      () => {
        setIsPlaying(true);
        setSource("gemini");
      },
      { once: true },
    );
    const cleanup = () => {
      URL.revokeObjectURL(url);
      if (audioRef.current === el) audioRef.current = null;
      setIsPlaying(false);
    };
    el.addEventListener("ended", cleanup, { once: true });
    el.addEventListener(
      "error",
      () => {
        cleanup();
        setError("network");
      },
      { once: true },
    );
    el.play().catch(() => {
      cleanup();
      setError("network");
    });
  };

  const speak = (text: string, lang: string) => {
    if (typeof window === "undefined") return;
    // Reset state and cancel any current playback.
    const prev = audioRef.current;
    if (prev) {
      prev.pause();
      prev.src = "";
    }
    audioRef.current = null;
    setIsPlaying(false);
    setError(null);
    setSource(null);

    const key = cacheKey(text, lang);
    const cached = blobCacheRef.current.get(key);
    if (cached) {
      playBlob(cached);
      return;
    }
    setIsLoading(true);
    void fetchCloudTts(text, lang).then((result) => {
      setIsLoading(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      blobCacheRef.current.set(key, result.audio);
      playBlob(result.audio);
    });
  };

  return { speak, stop, isPlaying, isLoading, error, source };
}
