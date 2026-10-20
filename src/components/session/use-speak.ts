"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * Normalize a BCP 47 tag to the short, lowercased language subtag used for
 * matching voice.lang prefixes (e.g. "ar-SA" or "AR" become "ar"). Keeps the
 * matching robust across the varied tags browsers hand back from
 * `speechSynthesis.getVoices()`.
 */
export function shortLang(lang: string): string {
  return (lang ?? "").toLowerCase().split(/[-_]/)[0];
}

export interface VoiceLike {
  lang: string;
  name?: string;
  default?: boolean;
}

/** Does the voice list contain any voice whose language starts with `lang`? */
export function hasVoiceForLang(voices: readonly VoiceLike[], lang: string): boolean {
  const target = shortLang(lang);
  if (!target) return false;
  return voices.some((v) => v.lang.toLowerCase().startsWith(target));
}

/**
 * Pick the first voice whose lang matches the requested short code. Prefers
 * a voice marked default in that language, then any match, else undefined so
 * the browser can fall back to its own default.
 */
export function pickVoice<T extends VoiceLike>(voices: readonly T[], lang: string): T | undefined {
  const target = shortLang(lang);
  if (!target) return undefined;
  const matches = voices.filter((v) => v.lang.toLowerCase().startsWith(target));
  if (matches.length === 0) return undefined;
  return matches.find((v) => v.default) ?? matches[0];
}

/**
 * The subset of SpeechSynthesis we touch. Deliberately widened to a
 * structural shape so unit tests can hand us a minimal stub without
 * reproducing all of SpeechSynthesisVoice's fields.
 */
type SynthesisLike = {
  cancel: () => void;
  speak: (utterance: SpeechSynthesisUtterance) => void;
  getVoices: () => readonly VoiceLike[];
  addEventListener?: (type: "voiceschanged", listener: () => void) => void;
  removeEventListener?: (type: "voiceschanged", listener: () => void) => void;
};

type UtteranceCtor = new (text: string) => SpeechSynthesisUtterance;

export interface SpeakerDeps {
  synthesis: SynthesisLike;
  Utterance: UtteranceCtor;
}

/** Where the audio for the current/last playback came from. */
export type SpeakSource = "browser" | "gemini" | null;

/**
 * Imperative speaker, free of React, so unit tests can drive it the same way
 * the browser would. The hook below wraps a single instance and subscribes
 * the component to its state transitions.
 */
export class Speaker {
  voices: VoiceLike[] = [];
  voiceLoaded = false;
  isPlaying = false;
  source: SpeakSource = null;
  private subs = new Set<() => void>();

  constructor(private readonly deps: SpeakerDeps) {}

  subscribe(fn: () => void): () => void {
    this.subs.add(fn);
    return () => {
      this.subs.delete(fn);
    };
  }

  private emit() {
    for (const fn of this.subs) fn();
  }

  refreshVoices(): void {
    const next = this.deps.synthesis.getVoices();
    this.voices = Array.isArray(next) ? next : [];
    this.voiceLoaded = this.voices.length > 0;
    this.emit();
  }

  hasVoiceFor(lang: string): boolean {
    return hasVoiceForLang(this.voices, lang);
  }

  speak(text: string, lang: string): () => void {
    this.deps.synthesis.cancel();
    this.source = "browser";
    const utterance = new this.deps.Utterance(text);
    utterance.lang = lang;
    const voice = pickVoice(this.voices, lang);
    if (voice) {
      // Browsers accept any voice from `getVoices()`; the cast narrows our
      // VoiceLike structural type to the DOM one at the assignment site.
      utterance.voice = voice as SpeechSynthesisVoice;
    }
    utterance.rate = 0.95;
    utterance.onstart = () => {
      this.isPlaying = true;
      this.emit();
    };
    utterance.onend = () => {
      this.isPlaying = false;
      this.emit();
    };
    utterance.onerror = () => {
      this.isPlaying = false;
      this.emit();
    };
    this.deps.synthesis.speak(utterance);
    this.emit();
    return () => {
      utterance.onstart = null;
      utterance.onend = null;
      utterance.onerror = null;
    };
  }

  stop(): void {
    this.deps.synthesis.cancel();
    if (this.isPlaying) {
      this.isPlaying = false;
      this.emit();
    }
  }

  /** Signal that a cloud-audio playback has started/ended. */
  setPlaying(playing: boolean, source: SpeakSource): void {
    this.source = source;
    if (this.isPlaying !== playing) {
      this.isPlaying = playing;
      this.emit();
    } else {
      // Still emit if the source changed so subscribers rerender.
      this.emit();
    }
  }
}

export interface UseSpeakApi {
  speak: (text: string, lang: string) => void;
  stop: () => void;
  isPlaying: boolean;
  voiceLoaded: boolean;
  hasVoiceFor: (lang: string) => boolean;
  supported: boolean;
  /** Which path produced the current / last playback: "browser" or "gemini". */
  source: SpeakSource;
}

const EMPTY_SUBSCRIBE = () => () => {};

/** Fetch result shape used by the cloud-TTS fallback. */
export interface CloudAudio {
  blob: Blob;
  provider: string;
}

/**
 * Minimal in-memory cache for cloud-TTS audio, keyed by (text, lang). Lives
 * for the current session only (page nav cost dwarfs the fetch anyway when
 * the server cache is warm).
 */
function cacheKey(text: string, lang: string): string {
  return `${lang}:${text}`;
}

/**
 * Fetch `/api/tts` and return the audio blob, or `null` on any failure
 * (including 503 "no key"). Exported for unit tests; the hook wires this to
 * an `HTMLAudioElement`.
 */
export async function fetchCloudTts(
  text: string,
  lang: string,
  fetcher: typeof fetch = fetch,
): Promise<CloudAudio | null> {
  let res: Response;
  try {
    res = await fetcher("/api/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, lang }),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const blob = await res.blob();
  return { blob, provider: res.headers.get("x-tts-provider") ?? "gemini" };
}

/**
 * Wire the browser's Web Speech API into React. Guarded for SSR: during
 * server render and in environments without speechSynthesis the hook returns
 * a no-op API with `supported: false`, so callers can still render the UI
 * and simply hide the button or show a fallback hint.
 *
 * When the browser has NO voice for the requested language, the hook calls
 * `/api/tts` (Gemini-backed) and plays the returned blob through an
 * `HTMLAudioElement`. If the server returns 503 (no key wired, mock mode) or
 * the fetch fails, we fall back to the browser's default voice so the
 * caregiver always hears something.
 */
export function useSpeak(): UseSpeakApi {
  // Keep the speaker instance in state rather than a ref: refs cannot be
  // read during render, and consumers need to render based on isPlaying and
  // voiceLoaded. The lazy initialiser only runs on the client because the
  // supported check gates it.
  const [speaker] = useState<Speaker | null>(() => {
    if (typeof window === "undefined" || typeof window.speechSynthesis === "undefined") return null;
    return new Speaker({ synthesis: window.speechSynthesis, Utterance: window.SpeechSynthesisUtterance });
  });
  const supported = speaker !== null;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobCacheRef = useRef<Map<string, CloudAudio>>(new Map());

  useEffect(() => {
    if (!speaker) return;
    speaker.refreshVoices();
    const synth = window.speechSynthesis;
    const onVoicesChanged = () => speaker.refreshVoices();
    synth.addEventListener?.("voiceschanged", onVoicesChanged);
    return () => {
      synth.removeEventListener?.("voiceschanged", onVoicesChanged);
      speaker.stop();
      // Tear down any in-flight cloud playback.
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, [speaker]);

  // Subscribe to the speaker's internal state so React re-renders when
  // isPlaying or voiceLoaded change. getServerSnapshot returns a stable
  // tuple so hydration matches the server render.
  const snapshot = useSyncExternalStore(
    speaker ? (fn) => speaker.subscribe(fn) : EMPTY_SUBSCRIBE,
    () =>
      speaker
        ? `${speaker.isPlaying ? 1 : 0}:${speaker.voiceLoaded ? 1 : 0}:${speaker.voices.length}:${speaker.source ?? ""}`
        : "0",
    () => "0",
  );
  void snapshot;

  const stopAll = () => {
    audioRef.current?.pause();
    if (audioRef.current) {
      audioRef.current.src = "";
    }
    audioRef.current = null;
    speaker?.stop();
  };

  const playCloud = async (text: string, lang: string): Promise<void> => {
    if (!speaker) return;
    const key = cacheKey(text, lang);
    let cached = blobCacheRef.current.get(key);
    if (!cached) {
      const fetched = await fetchCloudTts(text, lang);
      if (!fetched) {
        // 503 (no key) / network / decode error: fall back to browser default voice.
        speaker.speak(text, lang);
        return;
      }
      cached = fetched;
      blobCacheRef.current.set(key, cached);
    }
    // Make a fresh audio element each call: reusing one across langs leaves
    // residual state in some browsers.
    const url = URL.createObjectURL(cached.blob);
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.addEventListener("play", () => speaker.setPlaying(true, "gemini"), { once: true });
    const onEnd = () => {
      speaker.setPlaying(false, "gemini");
      URL.revokeObjectURL(url);
      if (audioRef.current === audio) audioRef.current = null;
    };
    audio.addEventListener("ended", onEnd, { once: true });
    audio.addEventListener("error", onEnd, { once: true });
    try {
      await audio.play();
    } catch {
      // Autoplay blocked or decode error: fall back to the browser voice.
      URL.revokeObjectURL(url);
      if (audioRef.current === audio) audioRef.current = null;
      speaker.speak(text, lang);
    }
  };

  return {
    supported,
    isPlaying: speaker?.isPlaying ?? false,
    voiceLoaded: speaker?.voiceLoaded ?? false,
    source: speaker?.source ?? null,
    hasVoiceFor: (lang: string) => (speaker ? speaker.hasVoiceFor(lang) : false),
    speak: (text: string, lang: string) => {
      if (!speaker) return;
      // Cancel any in-flight playback (either path) before starting a new one.
      stopAll();
      if (speaker.hasVoiceFor(lang)) {
        speaker.speak(text, lang);
        return;
      }
      // No browser voice: try the cloud path. Fire-and-forget: the hook
      // state transitions as the audio element reports play/end.
      void playCloud(text, lang);
    },
    stop: stopAll,
  };
}
