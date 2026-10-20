"use client";

import { Volume1Icon, Volume2Icon } from "lucide-react";
import { useMemo } from "react";
import { useSpeak } from "@/components/session/use-speak";
import { useMessages } from "@/i18n/provider";
import { cn } from "@/lib/utils";

/**
 * Human-readable language name in the caregiver's language, so the fallback
 * line reads naturally for them. Falls back to the raw tag if the Intl
 * runtime cannot resolve it (older or stripped-down builds).
 */
function languageName(lang: string, uiLang: string): string {
  try {
    return new Intl.DisplayNames([uiLang], { type: "language" }).of(lang) ?? lang;
  } catch {
    return lang;
  }
}

/**
 * Small speaker next to the SAY block that reads the prompt aloud in the
 * person's language. Keyboard-accessible (tabbable, Space/Enter via native
 * button semantics). When no voice for `promptLang` is installed, we still
 * render the button (the browser default voice reads something) but show a
 * short fallback hint so the caregiver knows pronunciation will be off.
 */
export function ListenButton({
  text,
  promptLang,
  caregiverLang,
  size = "md",
}: {
  text: string;
  promptLang: string;
  caregiverLang: string;
  size?: "md" | "lg";
}) {
  const t = useMessages().step;
  const { speak, stop, isPlaying, hasVoiceFor, voiceLoaded, supported } = useSpeak();
  const human = useMemo(() => languageName(promptLang, caregiverLang), [promptLang, caregiverLang]);
  if (!supported || !text) return null;
  const Icon = isPlaying ? Volume1Icon : Volume2Icon;
  // Only treat the voice as missing after the browser has reported its list
  // (first call to `getVoices` returns [] in some engines until the
  // voiceschanged event fires).
  const missing = voiceLoaded && !hasVoiceFor(promptLang);
  const label = t.listenHint(human);
  const sizeClass = size === "lg" ? "size-12" : "size-9";
  const iconClass = size === "lg" ? "size-5" : "size-4";
  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={() => {
          if (isPlaying) stop();
          else speak(text, promptLang);
        }}
        aria-label={label}
        aria-pressed={isPlaying}
        data-testid="step-listen"
        data-playing={isPlaying || undefined}
        className={cn(
          "inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full border-2 border-transparent bg-sage-soft text-sage-ink transition-[background-color,box-shadow,transform] duration-150 hover:bg-sage-soft/80 hover:shadow-paper focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-ring active:translate-y-px motion-reduce:transition-none",
          sizeClass,
          isPlaying && "animate-pulse motion-reduce:animate-none",
        )}
      >
        <Icon className={iconClass} aria-hidden />
        <span className="sr-only">{t.listen}</span>
      </button>
      {missing && (
        <p className="text-xs text-muted-foreground" data-testid="step-listen-no-voice" lang={caregiverLang}>
          {t.listenNoVoice(human)}
        </p>
      )}
    </div>
  );
}
