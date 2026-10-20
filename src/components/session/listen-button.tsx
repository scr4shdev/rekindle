"use client";

import { Loader2Icon, Volume1Icon, Volume2Icon, VolumeXIcon } from "lucide-react";
import { useMemo } from "react";
import { useSpeak } from "@/components/session/use-speak";
import { useMessages } from "@/i18n/provider";
import { cn } from "@/lib/utils";

/**
 * Human-readable language name in the caregiver's language, so the aria-label
 * reads naturally for them. Falls back to the raw tag if the Intl runtime
 * cannot resolve it (older or stripped-down builds).
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
 * person's language. The audio always comes from the Gemini-backed `/api/tts`
 * route. There is no browser Web Speech fallback. If the cloud service is
 * unreachable the button shows an honest error state (no cranky OS voice).
 * Keyboard-accessible (tabbable, Space/Enter via native button semantics).
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
  const { speak, stop, isPlaying, isLoading, error } = useSpeak();
  const human = useMemo(() => languageName(promptLang, caregiverLang), [promptLang, caregiverLang]);
  if (!text) return null;
  const label = t.listenHint(human);
  const sizeClass = size === "lg" ? "size-12" : "size-9";
  const iconClass = size === "lg" ? "size-5" : "size-4";

  const Icon = isLoading ? Loader2Icon : isPlaying ? Volume1Icon : error ? VolumeXIcon : Volume2Icon;

  const buttonTone = error
    ? "bg-rose-100 text-rose-900 hover:bg-rose-100/80 dark:bg-rose-950/40 dark:text-rose-100"
    : "bg-sage-soft text-sage-ink hover:bg-sage-soft/80";

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
        aria-busy={isLoading || undefined}
        data-testid="step-listen"
        data-playing={isPlaying || undefined}
        data-loading={isLoading || undefined}
        data-error={error ? error : undefined}
        className={cn(
          "inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full border-2 border-transparent transition-[background-color,box-shadow,transform] duration-150 hover:shadow-paper focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-ring active:translate-y-px motion-reduce:transition-none",
          sizeClass,
          buttonTone,
          isPlaying && "animate-pulse motion-reduce:animate-none",
        )}
      >
        <Icon
          className={cn(iconClass, isLoading && "animate-spin motion-reduce:animate-none")}
          aria-hidden
        />
        <span className="sr-only">{t.listen}</span>
      </button>
      {error ? (
        <p
          className="text-xs text-muted-foreground"
          data-testid="step-listen-error"
          lang={caregiverLang}
        >
          {t.listenError}
        </p>
      ) : null}
    </div>
  );
}
