"use client";

/**
 * Printable one-page session card.
 *
 * A night-shift aide should be able to run the plan from a single sheet of A4
 * without opening the app. We re-run the same stream the session view uses
 * (persona slug, or "custom" pulled from pending-request memory), wait for the
 * plan + anchors events, and lay the result out as a paper sheet.
 *
 * No new storage: nothing about the person leaves this tab. If the request
 * cannot be resolved, or no plan arrives, we show a short "not found" line
 * rather than a stale fallback.
 */

import { PrinterIcon } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo } from "react";
import { resolveRequest } from "@/components/session/session-request";
import { resolveSource } from "@/components/session/source";
import { useAgentStream } from "@/hooks/use-agent-stream";
import { MessagesProvider, useMessages } from "@/i18n/provider";
import type { Anchors, SessionPlan, SessionStep, StepKind } from "@/lib/domain/types";

interface PrintSessionCardProps {
  /** Route id (persona slug: maria, seamus, fatima, or "custom"). */
  id: string;
}

export function PrintSessionCard({ id }: PrintSessionCardProps) {
  const params = useSearchParams();
  const modeParam = params.get("mode");
  const resolved = useMemo(() => resolveRequest(id, modeParam), [id, modeParam]);

  const sessionLanguage = resolved.ok ? (resolved.request.person.sessionLanguage ?? "en") : "en";
  const caregiverLanguage = resolved.ok ? (resolved.request.person.caregiverLanguage ?? "en") : "en";
  const hasRecording = resolved.ok && resolved.hasRecording;
  const personaSlug = resolved.ok ? resolved.persona : undefined;

  const source = useMemo(
    () => resolveSource("auto", { hasRecording, language: sessionLanguage, personaSlug }),
    [hasRecording, sessionLanguage, personaSlug],
  );

  const { view, start } = useAgentStream(source, caregiverLanguage);

  useEffect(() => {
    if (resolved.ok) start(resolved.request);
  }, [resolved, start]);

  if (!resolved.ok) {
    return (
      <MessagesProvider language="en">
        <NotFoundBody />
      </MessagesProvider>
    );
  }

  const plan = view.plan;
  const anchors = view.anchors;
  const name = resolved.name;

  return (
    <MessagesProvider language={caregiverLanguage}>
      <PrintShell>
        {!plan || !anchors ? (
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

function NotFoundBody() {
  const t = useMessages().print;
  return (
    <div className="min-h-screen bg-sage-soft/60 print:bg-white">
      <div className="mx-auto max-w-xl px-6 py-16 text-center">
        <p className="font-heading text-2xl font-semibold text-sage-ink">{t.printNotFound}</p>
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
  anchors: Anchors;
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
