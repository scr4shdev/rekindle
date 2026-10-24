"use client";

/**
 * Printable one-page session card.
 *
 * A night-shift aide should be able to run the plan from a single sheet of A4
 * without opening the app. The sunny path is a sessionStorage hand-off: when
 * the caregiver clicks "Print session card" from /session, that tab has
 * already written the composed plan into sessionStorage and the print tab
 * (opened via a same-origin target="_blank" link) reads it back. No second
 * agent run, no risk of a different plan on the sheet than on the screen.
 *
 * Fallbacks:
 * - a persona slug with no sessionStorage entry (e.g. a direct link to
 *   /plan/maria/print) falls through to the ordinary agent stream, honoring
 *   the ?source= param from the URL (replay / sample / auto);
 * - a "custom" slug with no sessionStorage entry renders a friendly, locale-
 *   correct not-found that explains the plan must be generated in the
 *   originating tab first.
 *
 * The agent stream (fallback only) is also error-aware: a 429, a deadline,
 * or a network failure renders a sage error block with a Try again button,
 * never a stuck "This usually takes 15-30 seconds".
 */

import { PrinterIcon, RotateCcwIcon, TriangleAlertIcon } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { readStoredPlan, type StoredPrintPlan } from "@/components/print/print-handoff";
import { resolveRequest } from "@/components/session/session-request";
import { parseSourceParam, resolveSource } from "@/components/session/source";
import { Button } from "@/components/ui/button";
import { useAgentStream } from "@/hooks/use-agent-stream";
import { MessagesProvider, useMessages } from "@/i18n/provider";
import type { SessionPlan, SessionStep, StepKind } from "@/lib/domain/types";

interface PrintSessionCardProps {
  /** Route id (persona slug: maria, seamus, fatima, or "custom"). */
  id: string;
}

/** Narrow anchors view the paper layout actually reads. */
interface PaperAnchors {
  birthYear: number;
  callbacks?: string[];
}

export function PrintSessionCard({ id }: PrintSessionCardProps) {
  const params = useSearchParams();
  const modeParam = params.get("mode");
  const sourceParam = parseSourceParam(params.get("source"));

  // Read sessionStorage once per mount. A later resolve must not bounce out
  // of a stream that already started.
  const [hydrated] = useState<StoredPrintPlan | undefined>(() => readStoredPlan(id));
  const resolved = useMemo(() => resolveRequest(id, modeParam), [id, modeParam]);

  const sessionLanguage =
    hydrated?.sessionLanguage ?? (resolved.ok ? (resolved.request.person.sessionLanguage ?? "en") : "en");
  const caregiverLanguage =
    hydrated?.caregiverLanguage ?? (resolved.ok ? (resolved.request.person.caregiverLanguage ?? "en") : "en");
  const hasRecording = resolved.ok && resolved.hasRecording;
  const personaSlug = resolved.ok ? resolved.persona : undefined;

  const source = useMemo(
    () => resolveSource(sourceParam, { hasRecording, language: sessionLanguage, personaSlug }),
    [sourceParam, hasRecording, sessionLanguage, personaSlug],
  );

  const { view, start } = useAgentStream(source, caregiverLanguage);
  // Bumping this triggers a fresh stream for a retry.
  const [retryKey, setRetryKey] = useState(0);
  const needsStream = !hydrated && resolved.ok;

  useEffect(() => {
    if (!needsStream) return;
    if (!resolved.ok) return;
    start(resolved.request);
    // retryKey intentionally kept in the deps so the retry button restarts the stream.
  }, [needsStream, resolved, start, retryKey]);

  // Custom id with no hand-off: this tab cannot generate the plan, so the
  // caregiver has to compose it in the originating tab first.
  if (id === "custom" && !hydrated) {
    return (
      <MessagesProvider language={caregiverLanguage}>
        <NotFoundBody variant="custom" />
      </MessagesProvider>
    );
  }
  // Unknown persona slug with no hand-off: nothing we can print.
  if (!resolved.ok && !hydrated) {
    return (
      <MessagesProvider language={caregiverLanguage}>
        <NotFoundBody variant="generic" />
      </MessagesProvider>
    );
  }

  const plan = hydrated?.plan ?? view.plan;
  const anchors: PaperAnchors | undefined = hydrated?.anchors ?? view.anchors;
  const name = hydrated?.displayName ?? (resolved.ok ? resolved.name : undefined);
  // Hydrated plans never trigger a stream, so a failure can only come from
  // the fallback path.
  const failure = !hydrated ? view.failure : undefined;

  return (
    <MessagesProvider language={caregiverLanguage}>
      <PrintShell>
        {failure ? (
          <PaperError onRetry={() => setRetryKey((n) => n + 1)} />
        ) : !plan || !anchors ? (
          <PaperWaiting />
        ) : (
          <PaperBody
            plan={plan}
            anchors={anchors}
            name={name}
            sessionLanguage={sessionLanguage}
            caregiverLanguage={caregiverLanguage}
          />
        )}
      </PrintShell>
    </MessagesProvider>
  );
}

function PrintShell({ children }: { children: React.ReactNode }) {
  const t = useMessages().print;
  return (
    <div className="min-h-screen bg-sage-soft/60 print:bg-white">
      <style>{`@media print { @page { size: A4 portrait; margin: 15mm; } }`}</style>
      <div className="mx-auto flex max-w-[210mm] flex-col items-stretch gap-4 px-4 py-8 print:gap-0 print:px-0 print:py-0">
        <div className="flex items-center justify-between gap-3 print:hidden">
          <p className="font-heading text-lg font-semibold text-sage-ink">{t.printTitle}</p>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-full bg-sage-ink px-5 py-2.5 font-semibold text-sage-soft shadow-paper transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sage-ink"
            data-testid="print-button"
          >
            <PrinterIcon className="size-5" aria-hidden />
            {t.printButton}
          </button>
        </div>
        <article
          className="mx-auto w-full bg-white text-neutral-900 shadow-paper print:shadow-none"
          data-testid="print-sheet"
          style={{ padding: "15mm" }}
        >
          {children}
        </article>
      </div>
    </div>
  );
}

function PaperWaiting() {
  const t = useMessages().session;
  return (
    <p className="text-base text-neutral-500" aria-live="polite">
      {t.waitHint}
    </p>
  );
}

function PaperError({ onRetry }: { onRetry: () => void }) {
  const t = useMessages().print;
  return (
    <div
      role="alert"
      data-testid="print-error"
      className="flex flex-col gap-3 rounded-2xl bg-sage-soft px-5 py-4 text-sage-ink sm:flex-row sm:items-center"
    >
      <TriangleAlertIcon className="size-6 shrink-0" aria-hidden />
      <p className="flex-1 font-semibold">{t.printError}</p>
      <Button variant="outline" onClick={onRetry} data-icon="inline-start" data-testid="print-retry">
        <RotateCcwIcon aria-hidden />
        {t.printRetry}
      </Button>
    </div>
  );
}

function NotFoundBody({ variant }: { variant: "custom" | "generic" }) {
  const t = useMessages().print;
  const message = variant === "custom" ? t.printNotFoundCustom : t.printNotFound;
  return (
    <div className="min-h-screen bg-sage-soft/60 print:bg-white">
      <div className="mx-auto max-w-xl px-6 py-16 text-center" data-testid="print-not-found">
        <p className="font-heading text-2xl font-semibold text-sage-ink">{message}</p>
      </div>
    </div>
  );
}

function PaperBody({
  plan,
  anchors,
  name,
  sessionLanguage,
  caregiverLanguage,
}: {
  plan: SessionPlan;
  anchors: PaperAnchors;
  name?: string;
  sessionLanguage: string;
  caregiverLanguage: string;
}) {
  const t = useMessages().print;
  const callbacks = anchors.callbacks ?? [];
  // Pick up to 6 steps to respect the A4 single-page budget. The compose phase
  // already caps at 5 to 6, so this trim is defensive, not expected.
  const steps = plan.steps.slice(0, 6);
  const dateLine = formatSessionDate(new Date(), caregiverLanguage);

  return (
    <div className="flex flex-col gap-6 leading-snug" style={{ fontSize: "12pt" }}>
      <header className="flex flex-col gap-1 border-b border-neutral-400 pb-3">
        <h1 className="font-heading text-2xl font-semibold tracking-tight" style={{ fontSize: "18pt" }}>
          {name ?? plan.title}
        </h1>
        <p className="text-neutral-700" style={{ fontSize: "11pt" }}>
          {t.printPersonMeta(anchors.birthYear, plan.language)}
        </p>
      </header>

      {callbacks.length > 0 && (
        <section aria-label={t.printWhatWeHeard}>
          <h2 className="font-heading font-semibold uppercase tracking-wider text-neutral-700" style={{ fontSize: "11pt" }}>
            {t.printWhatWeHeard}
          </h2>
          <ul className="mt-1 flex flex-col gap-1">
            {callbacks.slice(0, 4).map((line, i) => (
              <li key={i} lang={caregiverLanguage} className="text-neutral-900">
                {line}
              </li>
            ))}
          </ul>
        </section>
      )}

      <ol className="flex flex-col gap-4">
        {steps.map((step, i) => (
          <PrintStep key={step.id} step={step} index={i + 1} sessionLanguage={sessionLanguage} />
        ))}
      </ol>

      <footer className="mt-auto flex flex-col gap-0.5 border-t border-neutral-400 pt-3 text-neutral-700" style={{ fontSize: "10pt" }}>
        <p>{t.printFooter}</p>
        <p>{t.printSessionDate(dateLine)}</p>
      </footer>
    </div>
  );
}

function PrintStep({
  step,
  index,
  sessionLanguage,
}: {
  step: SessionStep;
  index: number;
  sessionLanguage: string;
}) {
  const t = useMessages().print;
  const { prompt, swap } = pickPromptAndSwap(step);
  const fallback = fallbackLine(step, t);

  return (
    <li className="break-inside-avoid">
      <div className="flex items-baseline gap-3">
        <span className="font-heading font-semibold text-neutral-700" style={{ fontSize: "11pt" }}>
          {index}.
        </span>
        <h3 className="font-heading font-semibold" style={{ fontSize: "14pt" }}>
          {step.title}
        </h3>
        <span className="ml-auto font-mono text-neutral-700" style={{ fontSize: "10pt" }}>
          {step.durationMin} min
        </span>
      </div>
      <p className="mt-1 text-neutral-900" lang={sessionLanguage}>
        {prompt}
      </p>
      {swap && (
        <p className="mt-0.5 text-neutral-700" style={{ fontSize: "11pt" }} lang={sessionLanguage}>
          {swap}
        </p>
      )}
      <p className="mt-0.5 text-neutral-700" style={{ fontSize: "11pt" }}>
        <span className="font-semibold">{t.printIfTheySayNo}:</span> {fallback}
      </p>
    </li>
  );
}

function pickPromptAndSwap(step: SessionStep): { prompt: string; swap?: string } {
  const options = [step.prompt, ...(step.followUps ?? [])].filter((s): s is string => Boolean(s && s.trim()));
  if (options.length === 0) return { prompt: step.prompt };
  const sorted = [...options].sort((a, b) => a.length - b.length);
  const prompt = sorted[0];
  const swap = sorted.find((s) => s !== prompt);
  return { prompt, swap };
}

/**
 * Synthesized "if they say no" line per step kind. The plan does not carry a
 * refusal fallback today, so we lean on a conservative gentle-redirect per the
 * step kind. Keep these calm, non-medical, caregiver-register.
 */
function fallbackLine(step: SessionStep, t: ReturnType<typeof useMessages>["print"]): string {
  const kind: StepKind = step.kind;
  return t.printFallbacks[kind] ?? t.printFallbacks.closing;
}

function formatSessionDate(now: Date, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}
