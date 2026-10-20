"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

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

/**
 * Imperative speaker, free of React, so unit tests can drive it the same way
 * the browser would. The hook below wraps a single instance and subscribes
 * the component to its state transitions.
 */
export class Speaker {
  voices: VoiceLike[] = [];
  voiceLoaded = false;
  isPlaying = false;
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
}

export interface UseSpeakApi {
  speak: (text: string, lang: string) => void;
  stop: () => void;
  isPlaying: boolean;
  voiceLoaded: boolean;
  hasVoiceFor: (lang: string) => boolean;
  supported: boolean;
}

const EMPTY_SUBSCRIBE = () => () => {};

/**
 * Wire the browser's Web Speech API into React. Guarded for SSR: during
 * server render and in environments without speechSynthesis the hook returns
 * a no-op API with `supported: false`, so callers can still render the UI
 * and simply hide the button or show a fallback hint.
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

  useEffect(() => {
    if (!speaker) return;
    speaker.refreshVoices();
    const synth = window.speechSynthesis;
    const onVoicesChanged = () => speaker.refreshVoices();
    synth.addEventListener?.("voiceschanged", onVoicesChanged);
    return () => {
      synth.removeEventListener?.("voiceschanged", onVoicesChanged);
      speaker.stop();
    };
  }, [speaker]);

  // Subscribe to the speaker's internal state so React re-renders when
  // isPlaying or voiceLoaded change. getServerSnapshot returns a stable
  // tuple so hydration matches the server render.
  const snapshot = useSyncExternalStore(
    speaker ? (fn) => speaker.subscribe(fn) : EMPTY_SUBSCRIBE,
    () => (speaker ? `${speaker.isPlaying ? 1 : 0}:${speaker.voiceLoaded ? 1 : 0}:${speaker.voices.length}` : "0"),
    () => "0",
  );
  void snapshot;

  return {
    supported,
    isPlaying: speaker?.isPlaying ?? false,
    voiceLoaded: speaker?.voiceLoaded ?? false,
    hasVoiceFor: (lang: string) => (speaker ? speaker.hasVoiceFor(lang) : false),
    speak: (text: string, lang: string) => {
      if (!speaker) return;
      speaker.speak(text, lang);
    },
    stop: () => {
      speaker?.stop();
    },
  };
}
