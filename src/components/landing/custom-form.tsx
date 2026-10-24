"use client";

import { ArrowRightIcon, InfoIcon, LoaderCircleIcon, ScaleIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type ComponentProps, type FormEvent, type ReactNode } from "react";
import { setPendingPerson } from "@/components/session/pending-request";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { getMessages } from "@/i18n";
import { PersonInput, type PersonInputDraft } from "@/lib/domain/types";
import { loadLatestFeedback, personKeyFromDisplayName, summarizeFeedback } from "@/lib/feedback-store";

/** Spoken-language choices (BCP 47). Free text is not needed for the demo. */
const LANGUAGES = ["en", "it", "fr", "es", "de", "pt", "nl", "pl", "ga", "el", "ar", "tr", "ur", "hi", "zh", "ja"];
const MINUTES = [10, 15, 20, 30];
const NOTES_MAX = 2000;
const MAX_YEAR = new Date().getFullYear();
const DRAFT_KEY = "rekindle:draft:notes";

type Field =
  | "displayName"
  | "notes"
  | "birthYear"
  | "birthPlace"
  | "sessionMinutes"
  | "culturalBackground"
  | "keyLifeEvents"
  | "calmingCues"
  | "thingsToAvoid"
  | "routines";
type Errors = Partial<Record<Field, string>>;
type Stage = "early" | "mid" | "late";

/**
 * A pasted "This is Me" sheet used to be split into fields on the client with
 * regex headings. That is semantic parsing (deciding which heading a line is
 * from) and AGENTS.md bans it in deterministic code. The notes textarea now
 * accepts the full sheet; the server-side parse-anchors prompt reads it with
 * schema-validated structured output.
 */

function languageName(tag: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

export function CustomForm() {
  const t = getMessages().form;
  const landing = getMessages().landing;
  const router = useRouter();
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [notes, setNotes] = useState("");
  const [grounded, setGrounded] = useState(true);
  const [minutes, setMinutes] = useState(20);
  const [errors, setErrors] = useState<Errors>({});
  const [pending, setPending] = useState(false);
  const [stage, setStage] = useState<Stage | "">("");
  const [culturalBackground, setCulturalBackground] = useState("");
  const [keyLifeEvents, setKeyLifeEvents] = useState("");
  const [calmingCues, setCalmingCues] = useState("");
  const [thingsToAvoid, setThingsToAvoid] = useState("");
  const [routines, setRoutines] = useState("");
  const [displayName, setDisplayName] = useState("");
  // "Last time" preview: a short summary of the most recent saved feedback
  // for this displayName (local-only). Prepended to notes on submission so
  // the parse agent can adjust. Caregiver can clear it for this one run.
  const [lastTimeSummary, setLastTimeSummary] = useState<string | null>(null);
  const [lastTimeDismissed, setLastTimeDismissed] = useState(false);
  // Mock-mode gate. Probe /api/health once on mount. When the backend reports
  // llm.mode !== "live" (either a legacy "mock" value or the new "unavailable"
  // state when no GEMINI_API_KEY is set), custom notes cannot be planned, so
  // we keep the form visible but un-submittable and nudge judges to the demo
  // personas.
  const [mockMode, setMockMode] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/health", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { llm?: { mode?: string } } | null) => {
        if (cancelled) return;
        const mode = data?.llm?.mode;
        if (mode && mode !== "live") setMockMode(true);
      })
      .catch(() => {
        // Health probe is a hint; if it fails, keep the form enabled.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Restore the in-progress notes draft so a reload or tab switch doesn't lose
  // what the caregiver was writing. Scoped to this tab only (sessionStorage),
  // kept out of the server-rendered HTML, cleared when the planner opens, and
  // never persists across sessions.
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(DRAFT_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot restore from external storage on mount.
      if (saved) setNotes(saved);
    } catch {
      // sessionStorage can be unavailable (private mode); ignore.
    }
  }, []);

  useEffect(() => {
    try {
      if (notes) sessionStorage.setItem(DRAFT_KEY, notes);
      else sessionStorage.removeItem(DRAFT_KEY);
    } catch {
      // ignore
    }
  }, [notes]);

  // Look up any prior saved feedback for this displayName. localStorage is
  // an external store, so we subscribe to it when the name changes. State
  // writes happen inside the async callback (not synchronously in the
  // effect body), which the hook linter accepts. Dismissal is reset here
  // too so retyping shows the fresh match.
  useEffect(() => {
    let cancelled = false;
    const trimmed = displayName.trim();
    personKeyFromDisplayName(trimmed).then((key) => {
      if (cancelled) return;
      const latest = key ? loadLatestFeedback(key) : null;
      const summary = latest ? summarizeFeedback(latest.entries) : "";
      setLastTimeSummary(summary.length > 0 ? summary : null);
      setLastTimeDismissed(false);
    });
    return () => {
      cancelled = true;
    };
  }, [displayName]);

  const errorText: Record<Field, string> = {
    notes: t.errors.notes,
    birthYear: t.errors.birthYear(MAX_YEAR),
    birthPlace: t.errors.birthPlace,
    displayName: t.errors.displayName,
    sessionMinutes: t.errors.sessionMinutes,
    culturalBackground: t.errors.culturalBackground,
    keyLifeEvents: t.errors.keyLifeEvents,
    calmingCues: t.errors.calmingCues,
    thingsToAvoid: t.errors.thingsToAvoid,
    routines: t.errors.routines,
  };

  function submit(form: HTMLFormElement | null, target: "session" | "compare") {
    if (!form) return;
    const data = new FormData(form);
    const text = (name: string) => {
      const value = String(data.get(name) ?? "").trim();
      return value === "" ? undefined : value;
    };
    const year = text("birthYear");
    // Prepend the "last time" one-liner so the parse agent can adjust.
    // Only when the caregiver has not dismissed it for this submission and
    // the displayName is non-empty. Clipped to the notes max (2000).
    const rawNotes = String(data.get("notes") ?? "");
    const useLastTime = Boolean(lastTimeSummary) && !lastTimeDismissed && text("displayName") !== undefined;
    const prepend = useLastTime && lastTimeSummary ? `Last time: ${lastTimeSummary}\n` : "";
    // Clip only the caregiver's own notes to the remaining budget so the
    // "last time" line never silently eats their text. Keep the newest
    // content (slice from the end) and surface a caption near the textarea.
    const budget = Math.max(0, NOTES_MAX - prepend.length);
    const clippedNotes = rawNotes.length > budget ? rawNotes.slice(rawNotes.length - budget) : rawNotes;
    const finalNotes = `${prepend}${clippedNotes}`;
    const draft: PersonInputDraft = {
      displayName: text("displayName"),
      notes: finalNotes,
      birthYear: year === undefined ? undefined : Number(year),
      birthPlace: text("birthPlace"),
      culturalBackground: text("culturalBackground"),
      keyLifeEvents: text("keyLifeEvents"),
      calmingCues: text("calmingCues"),
      thingsToAvoid: text("thingsToAvoid"),
      routines: text("routines"),
      stage: stage === "" ? undefined : stage,
      sessionLanguage: text("sessionLanguage") ?? "en",
      caregiverLanguage: text("caregiverLanguage") ?? "en",
      sessionMinutes: minutes,
    };
    const result = PersonInput.safeParse(draft);
    if (!result.success) {
      const next: Errors = {};
      for (const issue of result.error.issues) {
        const field = issue.path[0] as Field;
        if (field in errorText && !next[field]) next[field] = errorText[field];
      }
      setErrors(next);
      const first = Object.keys(next)[0];
      if (first) formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
      return;
    }
    setErrors({});
    setPendingPerson(result.data);
    try {
      sessionStorage.removeItem(DRAFT_KEY);
    } catch {
      // ignore
    }
    setPending(true);
    const mode = grounded ? "grounded" : "llm-only";
    router.push(target === "compare" ? "/compare?persona=custom" : `/session?persona=custom&mode=${mode}`);
  }

  const hasErrors = Object.keys(errors).length > 0;
  // Budget preview mirroring the submit-time computation so the caregiver
  // sees that long notes will be clipped before they tap submit.
  const lastTimeActive = Boolean(lastTimeSummary) && !lastTimeDismissed && displayName.trim().length > 0;
  const prependPreviewLength = lastTimeActive && lastTimeSummary ? `Last time: ${lastTimeSummary}\n`.length : 0;
  const notesBudget = Math.max(0, NOTES_MAX - prependPreviewLength);
  const notesOverBudget = prependPreviewLength > 0 && notes.length > notesBudget;

  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={(e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        submit(e.currentTarget, "session");
      }}
      className="grid grid-cols-1 gap-6 rounded-3xl border border-border bg-card p-5 shadow-paper sm:p-8"
      aria-describedby={hasErrors ? `${id}-errors` : undefined}
      data-testid="custom-form"
      data-mock-mode={mockMode || undefined}
    >
      {hasErrors && (
        <p id={`${id}-errors`} role="alert" className="rounded-2xl bg-rose-soft px-4 py-3 font-semibold text-rose-ink">
          {t.errorsTitle}
        </p>
      )}
      {mockMode && (
        <div
          id={`${id}-mock-gate`}
          data-testid="custom-form-mock-gate"
          role="note"
          className="flex items-start gap-3 rounded-2xl border border-ochre bg-ochre-soft px-4 py-3 text-ochre-ink"
        >
          <InfoIcon className="mt-0.5 size-5 shrink-0" aria-hidden />
          <div className="grid gap-0.5">
            <p className="font-semibold">{landing.mockGateTitle}</p>
            <p className="text-[0.95rem]">{landing.mockGateBody}</p>
          </div>
        </div>
      )}
      <section aria-labelledby={`${id}-tim-title`} className="grid gap-2 rounded-2xl border border-dashed border-border bg-muted/40 p-4">
        <h3 id={`${id}-tim-title`} className="text-base font-semibold">
          {t.thisIsMeTitle}
        </h3>
        <p className="text-[0.95rem] text-muted-foreground">{t.thisIsMeIntro}</p>
      </section>

      <div className="grid gap-6 sm:grid-cols-3">
        <FormField id={`${id}-name`} label={t.displayName} hint={t.displayNameHint} error={errors.displayName}>
          {(props) => (
            <Input
              {...props}
              name="displayName"
              maxLength={60}
              autoComplete="off"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          )}
        </FormField>
        <FormField id={`${id}-year`} label={t.birthYear} error={errors.birthYear}>
          {(props) => <Input {...props} name="birthYear" type="number" inputMode="numeric" min={1880} max={MAX_YEAR} placeholder="e.g. 1946" />}
        </FormField>
        <FormField id={`${id}-place`} label={t.birthPlace} error={errors.birthPlace}>
          {(props) => <Input {...props} name="birthPlace" maxLength={120} placeholder={t.birthPlacePlaceholder} autoComplete="off" />}
        </FormField>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <FormField id={`${id}-cult`} label={t.culturalBackground} hint={t.culturalBackgroundHint} error={errors.culturalBackground}>
          {(props) => (
            <Textarea
              {...props}
              name="culturalBackground"
              maxLength={400}
              rows={2}
              value={culturalBackground}
              onChange={(e) => setCulturalBackground(e.target.value)}
              placeholder={t.culturalBackgroundPlaceholder}
              disabled={mockMode}
            />
          )}
        </FormField>
        <FormField id={`${id}-events`} label={t.keyLifeEvents} hint={t.keyLifeEventsHint} error={errors.keyLifeEvents}>
          {(props) => (
            <Textarea
              {...props}
              name="keyLifeEvents"
              maxLength={400}
              rows={2}
              value={keyLifeEvents}
              onChange={(e) => setKeyLifeEvents(e.target.value)}
              placeholder={t.keyLifeEventsPlaceholder}
              disabled={mockMode}
            />
          )}
        </FormField>
        <FormField id={`${id}-calm`} label={t.calmingCues} hint={t.calmingCuesHint} error={errors.calmingCues}>
          {(props) => (
            <Textarea
              {...props}
              name="calmingCues"
              maxLength={400}
              rows={2}
              value={calmingCues}
              onChange={(e) => setCalmingCues(e.target.value)}
              placeholder={t.calmingCuesPlaceholder}
              disabled={mockMode}
            />
          )}
        </FormField>
        <FormField id={`${id}-avoid`} label={t.thingsToAvoid} hint={t.thingsToAvoidHint} error={errors.thingsToAvoid}>
          {(props) => (
            <Textarea
              {...props}
              name="thingsToAvoid"
              maxLength={400}
              rows={2}
              value={thingsToAvoid}
              onChange={(e) => setThingsToAvoid(e.target.value)}
              placeholder={t.thingsToAvoidPlaceholder}
              disabled={mockMode}
            />
          )}
        </FormField>
        <FormField id={`${id}-routines`} label={t.routines} hint={t.routinesHint} error={errors.routines}>
          {(props) => (
            <Textarea
              {...props}
              name="routines"
              maxLength={400}
              rows={2}
              value={routines}
              onChange={(e) => setRoutines(e.target.value)}
              placeholder={t.routinesPlaceholder}
              disabled={mockMode}
            />
          )}
        </FormField>
        <fieldset className="grid min-w-0 content-start gap-2">
          <legend className="mb-1 text-base font-semibold">{t.stage}</legend>
          <p className="text-[0.95rem] text-muted-foreground">{t.stageHint}</p>
          <div className="flex gap-1.5 rounded-full bg-muted p-1" role="radiogroup" aria-label={t.stage}>
            <StageOption label={t.stageOptions.none} value="" selected={stage === ""} onSelect={() => setStage("")} />
            <StageOption label={t.stageOptions.early} value="early" selected={stage === "early"} onSelect={() => setStage("early")} title={t.stageTooltips.early} />
            <StageOption label={t.stageOptions.mid} value="mid" selected={stage === "mid"} onSelect={() => setStage("mid")} title={t.stageTooltips.mid} />
            <StageOption label={t.stageOptions.late} value="late" selected={stage === "late"} onSelect={() => setStage("late")} title={t.stageTooltips.late} />
          </div>
        </fieldset>
      </div>

      {lastTimeSummary && !lastTimeDismissed && displayName.trim().length > 0 && (
        <aside
          data-testid="last-time-preview"
          className="rounded-2xl border border-sage-soft/60 bg-sage-soft/30 px-5 py-4"
          aria-label={getMessages().session.feedbackLastTimeHeading(displayName.trim())}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="grid gap-1">
              <p className="text-xs font-semibold tracking-wide text-sage-ink/70 uppercase">
                {getMessages().session.feedbackLastTimeHeading(displayName.trim())}
              </p>
              <p className="text-[0.95rem] text-sage-ink">{lastTimeSummary}</p>
              <p className="text-[0.9rem] text-sage-ink/80">{getMessages().session.feedbackLastTimeIntro}</p>
            </div>
            <button
              type="button"
              onClick={() => setLastTimeDismissed(true)}
              className="shrink-0 text-sm font-semibold text-sage-ink underline-offset-4 hover:underline"
              data-testid="last-time-clear"
            >
              Clear
            </button>
          </div>
        </aside>
      )}

      <FormField id={`${id}-notes`} label={t.notes} hint={t.notesHint} error={errors.notes}>
        {(props) => (
          <>
            <Textarea
              {...props}
              name="notes"
              required
              maxLength={NOTES_MAX}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t.notesPlaceholder}
              className="field-sizing-fixed"
              rows={5}
              disabled={mockMode}
            />
            <span className="text-right text-sm text-muted-foreground" aria-live="polite">
              {t.notesCount(notes.length, NOTES_MAX)}
            </span>
            {notesOverBudget && (
              <p
                data-testid="notes-capped-caption"
                role="status"
                className="text-[0.9rem] font-semibold text-ochre-ink"
              >
                {t.notesCapped(notesBudget)}
              </p>
            )}
          </>
        )}
      </FormField>

      <div className="grid gap-6 sm:grid-cols-3">
        <FormField id={`${id}-slang`} label={t.sessionLanguage}>
          {(props) => <LanguageSelect {...props} name="sessionLanguage" defaultValue="en" />}
        </FormField>
        <FormField id={`${id}-clang`} label={t.caregiverLanguage}>
          {(props) => <LanguageSelect {...props} name="caregiverLanguage" defaultValue="en" />}
        </FormField>
        <fieldset className="grid gap-2">
          <legend className="mb-2 text-base font-semibold">{t.minutes}</legend>
          <div className="flex gap-1.5 rounded-full bg-muted p-1">
            {MINUTES.map((m) => (
              <label
                key={m}
                className="flex h-10 flex-1 cursor-pointer items-center justify-center rounded-full text-[0.95rem] font-semibold text-muted-foreground has-checked:bg-card has-checked:text-foreground has-checked:shadow-paper has-focus-visible:outline-3 has-focus-visible:outline-ring"
              >
                <input
                  type="radio"
                  name="sessionMinutes"
                  value={m}
                  checked={minutes === m}
                  onChange={() => setMinutes(m)}
                  className="sr-only"
                />
                {t.minutesOption(m)}
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="flex items-start gap-4 rounded-2xl bg-sage-soft/60 p-4">
        <Switch id={`${id}-grounded`} checked={grounded} onCheckedChange={setGrounded} aria-describedby={`${id}-grounded-hint`} />
        <div className="grid gap-0.5">
          <Label htmlFor={`${id}-grounded`}>{t.grounded}</Label>
          <p id={`${id}-grounded-hint`} className="text-[0.95rem] text-muted-foreground">
            {t.groundedHint}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button
          type="submit"
          size="lg"
          data-icon="inline-end"
          disabled={pending || mockMode}
          aria-busy={pending || undefined}
          aria-describedby={mockMode ? `${id}-mock-gate` : undefined}
        >
          {pending ? t.submitPending : t.submit}
          {pending ? <LoaderCircleIcon className="animate-spin" aria-hidden /> : <ArrowRightIcon aria-hidden />}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="lg"
          onClick={() => submit(formRef.current, "compare")}
          data-icon="inline-start"
          disabled={pending || mockMode}
          aria-describedby={mockMode ? `${id}-mock-gate` : undefined}
        >
          <ScaleIcon aria-hidden />
          {t.compare}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">{t.privacy}</p>
    </form>
  );
}

function StageOption({ label, value, selected, onSelect, title }: { label: string; value: string; selected: boolean; onSelect: () => void; title?: string }) {
  return (
    <label
      title={title}
      className="flex h-10 flex-1 cursor-pointer items-center justify-center rounded-full text-[0.9rem] font-semibold text-muted-foreground has-checked:bg-card has-checked:text-foreground has-checked:shadow-paper has-focus-visible:outline-3 has-focus-visible:outline-ring"
    >
      <input type="radio" name="stage" value={value} checked={selected} onChange={onSelect} className="sr-only" />
      {label}
    </label>
  );
}

function LanguageSelect(props: ComponentProps<"select">) {
  return (
    <select
      {...props}
      className="h-12 w-full cursor-pointer rounded-xl border-2 border-input bg-card px-4 text-base focus-visible:border-ring focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring/40"
    >
      {LANGUAGES.map((tag) => (
        <option key={tag} value={tag}>
          {languageName(tag)}
        </option>
      ))}
    </select>
  );
}

function FormField({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: (props: { id: string; "aria-invalid"?: boolean; "aria-describedby"?: string }) => ReactNode;
}) {
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;
  return (
    <div className="grid min-w-0 content-start gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy })}
      {hint && (
        <p id={`${id}-hint`} className="text-[0.95rem] text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="font-semibold text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
