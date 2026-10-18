"use client";

import type { SessionView } from "@/components/session/view-state";
import { getMessages } from "@/i18n";

export function PlanTimeline({ view }: { view: SessionView }) {
  const t = getMessages().session;
  return (
    <section aria-labelledby="plan-title" className="flex flex-col gap-4" data-testid="plan-timeline">
      <h2 id="plan-title" className="text-2xl font-semibold">
        {t.planTitle}
      </h2>
      {view.steps.length === 0 ? (
        <p className="text-muted-foreground">{t.planWaiting}</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {view.steps.map((step) => (
            <li key={step.id} className="rounded-2xl border border-border bg-card p-4">
              {step.title}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
