"use client";

import { ArrowRightIcon, ScaleIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, type ComponentProps, type FormEvent, type ReactNode } from "react";
import { setPendingPerson } from "@/components/session/pending-request";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { getMessages } from "@/i18n";
import { PersonInput, type PersonInputDraft } from "@/lib/domain/types";

/** Spoken-language choices (BCP 47). Free text is not needed for the demo. */
const LANGUAGES = ["en", "it", "fr", "es", "de", "pt", "nl", "pl", "ga", "el", "ar", "tr", "ur", "hi", "zh", "ja"];
const MINUTES = [10, 15, 20, 30];
const NOTES_MAX = 2000;
const MAX_YEAR = new Date().getFullYear();

type Field = "displayName" | "notes" | "birthYear" | "birthPlace" | "sessionMinutes";
type Errors = Partial<Record<Field, string>>;

function languageName(tag: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

export function CustomForm() {
  const t = getMessages().form;
  const router = useRouter();
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [notes, setNotes] = useState("");
  const [grounded, setGrounded] = useState(true);
  const [minutes, setMinutes] = useState(20);
  const [errors, setErrors] = useState<Errors>({});

  const errorText: Record<Field, string> = {
    notes: t.errors.notes,
    birthYear: t.errors.birthYear(MAX_YEAR),
    birthPlace: t.errors.birthPlace,
    displayName: t.errors.displayName,
    sessionMinutes: t.errors.sessionMinutes,
  };

  function submit(form: HTMLFormElement | null, target: "session" | "compare") {
    if (!form) return;
    const data = new FormData(form);
    const text = (name: string) => {
      const value = String(data.get(name) ?? "").trim();
      return value === "" ? undefined : value;
    };
    const year = text("birthYear");
    const draft: PersonInputDraft = {
      displayName: text("displayName"),
      notes: String(data.get("notes") ?? ""),
      birthYear: year === undefined ? undefined : Number(year),
      birthPlace: text("birthPlace"),
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
    const mode = grounded ? "grounded" : "llm-only";
    router.push(target === "compare" ? "/compare?persona=custom" : `/session?persona=custom&mode=${mode}`);
  }

  const hasErrors = Object.keys(errors).length > 0;

  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={(e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        submit(e.currentTarget, "session");
      }}
      className="grid gap-6 rounded-3xl border border-border bg-card p-5 shadow-paper sm:p-8"
      aria-describedby={hasErrors ? `${id}-errors` : undefined}
      data-testid="custom-form"
    >
      {hasErrors && (
        <p id={`${id}-errors`} role="alert" className="rounded-2xl bg-rose-soft px-4 py-3 font-semibold text-rose-ink">
          {t.errorsTitle}
        </p>
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
              rows={5}
            />
            <span className="text-right text-sm text-muted-foreground" aria-live="polite">
              {t.notesCount(notes.length, NOTES_MAX)}
            </span>
          </>
        )}
      </FormField>

      <div className="grid gap-6 sm:grid-cols-3">
        <FormField id={`${id}-name`} label={t.displayName} hint={t.displayNameHint} error={errors.displayName}>
          {(props) => <Input {...props} name="displayName" maxLength={60} autoComplete="off" />}
        </FormField>
        <FormField id={`${id}-year`} label={t.birthYear} error={errors.birthYear}>
          {(props) => <Input {...props} name="birthYear" type="number" inputMode="numeric" min={1880} max={MAX_YEAR} placeholder="e.g. 1946" />}
        </FormField>
        <FormField id={`${id}-place`} label={t.birthPlace} error={errors.birthPlace}>
          {(props) => <Input {...props} name="birthPlace" maxLength={120} placeholder={t.birthPlacePlaceholder} autoComplete="off" />}
        </FormField>
      </div>

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
        <Button type="submit" size="lg" data-icon="inline-end">
          {t.submit}
          <ArrowRightIcon aria-hidden />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="lg"
          onClick={() => submit(formRef.current, "compare")}
          data-icon="inline-start"
        >
          <ScaleIcon aria-hidden />
          {t.compare}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">{t.privacy}</p>
    </form>
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
    <div className="grid content-start gap-2">
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
