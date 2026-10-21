"use client";

/**
 * Post-session note-back loop. After the plan is composed and the "done" state
 * is reached, the caregiver can mark each step as sparked, did not land, or
 * walked away, with an optional one-line note. The whole set is written to
 * localStorage keyed by a sha256 of the person's displayName; the next intake
 * reads it back and prepends a short summary.
 *
 * Pure client UI. No logging of plaintext notes or names.
 */
import { CheckCircle2Icon, SaveIcon } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMessages } from "@/i18n/provider";
import type { SessionPlan } from "@/lib/domain/types";
import {
  type FeedbackEntry,
  type FeedbackReaction,
  NOTE_MAX,
  personKeyFromDisplayName,
  saveFeedback,
} from "@/lib/feedback-store";
import { cn } from "@/lib/utils";

interface FeedbackPanelProps {
  plan: SessionPlan;
  displayName: string | undefined;
}

interface StepFeedbackState {
  reaction: FeedbackReaction | null;
  note: string;
}

export function FeedbackPanel({ plan, displayName }: FeedbackPanelProps) {
  const t = useMessages().session;
  const headingId = useId();
  const [state, setState] = useState<Record<string, StepFeedbackState>>(() =>
    Object.fromEntries(plan.steps.map((s) => [s.id, { reaction: null, note: "" }])),
  );
  const [personKey, setPersonKey] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Hash the displayName once per mount (or when it changes). We never
  // keep plaintext in state longer than needed and never log it.
  useEffect(() => {
    let cancelled = false;
    personKeyFromDisplayName(displayName).then((key) => {
      if (!cancelled) setPersonKey(key);
    });
    return () => {
      cancelled = true;
    };
  }, [displayName]);

  const canSave = useMemo(() => {
    if (!personKey) return false;
    return Object.values(state).some((v) => v.reaction !== null || (v.note && v.note.trim().length > 0));
  }, [personKey, state]);

  function setReaction(stepId: string, reaction: FeedbackReaction) {
    setSaved(false);
    setState((prev) => ({
      ...prev,
      [stepId]: {
        ...(prev[stepId] ?? { reaction: null, note: "" }),
        // Toggling the same reaction clears it.
        reaction: prev[stepId]?.reaction === reaction ? null : reaction,
      },
    }));
  }

  function setNote(stepId: string, note: string) {
    setSaved(false);
    const clipped = note.length > NOTE_MAX ? note.slice(0, NOTE_MAX) : note;
    setState((prev) => ({
      ...prev,
      [stepId]: { ...(prev[stepId] ?? { reaction: null, note: "" }), note: clipped },
    }));
  }

  function onSave() {
    if (!personKey) return;
    const entries: FeedbackEntry[] = plan.steps.map((s) => {
      const row = state[s.id] ?? { reaction: null, note: "" };
      return {
        stepId: s.id,
        stepLabel: s.entity?.name ?? s.title,
        reaction: row.reaction,
        note: row.note.trim().length === 0 ? null : row.note,
        savedAt: "",
      };
    });
    saveFeedback(personKey, plan.id, entries);
    setSaved(true);
  }

  if (!displayName) return null;

  return (
    <section
      aria-labelledby={headingId}
      data-testid="feedback-panel"
      className="rounded-2xl border border-border bg-card p-5 print:hidden"
    >
      <h2 id={headingId} className="text-lg font-semibold">
        {t.feedbackHeading}
      </h2>
      <ul className="mt-4 flex flex-col gap-4">
        {plan.steps.map((step, i) => {
          const row = state[step.id] ?? { reaction: null, note: "" };
          const label = step.entity?.name ?? step.title;
          return (
            <li key={step.id} className="flex flex-col gap-2 border-t border-border/60 pt-3 first:border-t-0 first:pt-0">
              <p className="text-[0.95rem] font-medium">
                {i + 1}. {label}
              </p>
              <div className="flex flex-wrap gap-2">
                <ReactionButton
                  active={row.reaction === "sparked"}
                  tone="sage"
                  label={t.feedbackButtonSparked}
                  onClick={() => setReaction(step.id, "sparked")}
                  stepId={step.id}
                  reaction="sparked"
                />
                <ReactionButton
                  active={row.reaction === "did_not_land"}
                  tone="muted"
                  label={t.feedbackButtonDidNotLand}
                  onClick={() => setReaction(step.id, "did_not_land")}
                  stepId={step.id}
                  reaction="did_not_land"
                />
                <ReactionButton
                  active={row.reaction === "walked_away"}
                  tone="rose"
                  label={t.feedbackButtonWalkedAway}
                  onClick={() => setReaction(step.id, "walked_away")}
                  stepId={step.id}
                  reaction="walked_away"
                />
              </div>
              <Input
                aria-label={t.feedbackInputPlaceholder}
                placeholder={t.feedbackInputPlaceholder}
                maxLength={NOTE_MAX}
                value={row.note}
                onChange={(e) => setNote(step.id, e.target.value)}
                data-testid={`feedback-note-${step.id}`}
              />
            </li>
          );
        })}
      </ul>
      <div className="mt-4 flex items-center gap-3">
        <Button
          type="button"
          onClick={onSave}
          disabled={!canSave}
          data-icon="inline-start"
          data-testid="feedback-save"
        >
          <SaveIcon aria-hidden />
          {t.feedbackSaveButton}
        </Button>
        {saved && (
          <p
            role="status"
            aria-live="polite"
            data-testid="feedback-saved"
            className="inline-flex items-center gap-2 text-[0.95rem] text-sage-ink"
          >
            <CheckCircle2Icon className="size-5" aria-hidden />
            {t.feedbackSavedConfirmation}
          </p>
        )}
      </div>
    </section>
  );
}

function ReactionButton({
  active,
  tone,
  label,
  onClick,
  stepId,
  reaction,
}: {
  active: boolean;
  tone: "sage" | "muted" | "rose";
  label: string;
  onClick: () => void;
  stepId: string;
  reaction: FeedbackReaction;
}) {
  const toneClass =
    tone === "sage"
      ? "data-[active=true]:bg-sage-soft data-[active=true]:text-sage-ink"
      : tone === "rose"
        ? "data-[active=true]:bg-rose-soft data-[active=true]:text-rose-ink"
        : "data-[active=true]:bg-muted data-[active=true]:text-foreground";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-active={active}
      data-testid={`feedback-${reaction}-${stepId}`}
      className={cn(
        "inline-flex h-10 items-center rounded-full border border-border bg-background px-4 text-[0.95rem] font-semibold text-muted-foreground",
        "hover:bg-muted/60 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring/40",
        toneClass,
      )}
    >
      {label}
    </button>
  );
}
