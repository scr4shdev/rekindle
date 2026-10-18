"use client";

import { CircleSlashIcon, ClockIcon, HeartHandshakeIcon, ListOrderedIcon, WandSparklesIcon } from "lucide-react";
import { StepCard } from "@/components/session/step-card";
import type { SessionView } from "@/components/session/view-state";
import { Badge } from "@/components/ui/badge";
import { getMessages } from "@/i18n";
import { cn } from "@/lib/utils";

export function PlanTimeline({
  view,
  language,
  caregiverLanguage,
  className,
}: {
  view: SessionView;
  language: string;
  caregiverLanguage: string;
  className?: string;
}) {
  const t = getMessages().session;
  const ts = getMessages().step;
  const tp = getMessages().print;
  const plan = view.plan;
  const composing = !plan && view.steps.length > 0;
  const minutes = plan?.totalMinutes ?? view.steps.reduce((n, s) => n + s.durationMin, 0);
  return (
    <section aria-labelledby="plan-title" className={cn("flex flex-col gap-4", className)} data-testid="plan-timeline" aria-busy={view.status === "streaming"}>
      {plan && (
        <div className="hidden print:block">
          <p className="text-sm tracking-wide uppercase">{tp.sheet}</p>
          <p className="font-heading text-3xl font-semibold" lang={plan.language}>
            {plan.title}
          </p>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 id="plan-title" className="text-2xl font-semibold sm:text-3xl">
          {t.planTitle}
        </h2>
        {view.steps.length > 0 && (
          <span className="flex flex-wrap items-center gap-3 text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <ListOrderedIcon className="size-5" aria-hidden />
              {t.stepsCount(view.steps.length)}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ClockIcon className="size-5" aria-hidden />
              {t.totalMinutes(minutes)}
            </span>
          </span>
        )}
        {composing && (
          <Badge variant="outline" className="animate-pulse">
            {t.planDraft}
          </Badge>
        )}
        {plan && plan.meta.revision > 0 && (
          <Badge variant="ochre">
            <WandSparklesIcon aria-hidden />
            {t.revision(plan.meta.revision)}
          </Badge>
        )}
      </div>

      {view.steps.length === 0 ? (
        <div className="flex flex-col gap-3" aria-hidden={view.status !== "streaming"}>
          <p className="rounded-3xl border-2 border-dashed border-border px-6 py-8 text-center text-lg text-muted-foreground">
            {t.planWaiting}
          </p>
          {view.status === "streaming" &&
            [0, 1, 2].map((i) => <div key={i} className="h-40 animate-pulse rounded-3xl bg-muted/70" style={{ animationDelay: `${i * 150}ms` }} />)}
        </div>
      ) : (
        <ol className="flex flex-col gap-4">
          {view.steps.map((step) => (
            <li key={step.id} className="animate-rise">
              <StepCard
                step={step}
                language={plan?.language ?? language}
                caregiverLanguage={plan?.caregiverLanguage ?? caregiverLanguage}
                changed={view.changedStepIds.includes(step.id)}
              />
            </li>
          ))}
        </ol>
      )}

      {view.removedStepLabels.length > 0 && (
        <ul className="flex flex-col gap-1.5" aria-label={ts.changed}>
          {view.removedStepLabels.map((label) => (
            <li key={label} className="flex items-center gap-2 text-muted-foreground">
              <CircleSlashIcon className="size-4 text-rose" aria-hidden />
              {ts.removed(label)}
            </li>
          ))}
        </ul>
      )}

      {plan && (
        <p className="flex gap-3 rounded-2xl bg-paper-deep px-5 py-4 text-[0.95rem] text-muted-foreground" lang={plan.caregiverLanguage}>
          <HeartHandshakeIcon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
          {plan.disclaimer}
        </p>
      )}
      {plan && <p className="hidden text-sm print:block">{tp.footer}</p>}
    </section>
  );
}
