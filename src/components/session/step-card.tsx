"use client";

import { BadgeCheckIcon, BotIcon, ExternalLinkIcon, LightbulbIcon, SearchIcon, TelescopeIcon } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { EraArt } from "@/components/era-art";
import { DOMAIN_MOTIF, STEP_ICON, STEP_MOTIF } from "@/components/session/icons";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getMessages } from "@/i18n";
import type { SessionStep } from "@/lib/domain/types";
import { cn } from "@/lib/utils";

export function ProvenanceBadge({ step }: { step: SessionStep }) {
  const t = getMessages().step;
  const entity = step.entity;
  const [label, hint, variant, Icon] =
    step.provenance === "llm-only" || !entity
      ? [t.llmOnly, t.llmOnlyHint, "clay" as const, BotIcon]
      : entity.provenance === "qloo-affinity"
        ? [t.discovery(entity.affinity !== undefined ? Math.round(entity.affinity * 100) : undefined), t.discoveryHint, "ochre" as const, TelescopeIcon]
        : [t.verified, t.verifiedHint, "sage" as const, BadgeCheckIcon];
  return (
    <Tooltip>
      <TooltipTrigger render={<Badge variant={variant} className="cursor-help" tabIndex={0} data-provenance={step.provenance} />}>
        <Icon aria-hidden />
        {label}
      </TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  );
}

/** Entity image when Qloo has one, otherwise an era-styled illustration. */
export function StepMedia({ step, className, large = false }: { step: SessionStep; className?: string; large?: boolean }) {
  const src = step.entity?.imageUrl ?? step.mediaUrl;
  const [failed, setFailed] = useState(false);
  const year = step.entity?.releaseYear;
  if (src && !failed) {
    return (
      <div className={cn("relative overflow-hidden bg-muted", className)}>
        <Image
          src={src}
          alt={step.entity?.name ?? step.title}
          fill
          unoptimized
          sizes={large ? "(min-width: 1024px) 50vw, 100vw" : "(min-width: 640px) 220px, 100vw"}
          className="object-cover sepia-[.15]"
          onError={() => setFailed(true)}
        />
      </div>
    );
  }
  const motif = step.entity ? DOMAIN_MOTIF[step.entity.domain] : STEP_MOTIF[step.kind];
  return (
    <EraArt motif={motif} className={cn("flex items-end", className)}>
      {(step.entity || year) && (
        <span
          aria-hidden
          className={cn(
            "m-3 max-w-[85%] rounded-xl bg-card/95 px-3 py-1.5 font-heading leading-tight font-semibold shadow-paper",
            large ? "text-2xl" : "text-base",
          )}
        >
          {step.entity?.name}
          {year && <span className="ml-2 font-sans text-[0.8em] font-normal text-muted-foreground">{year}</span>}
        </span>
      )}
    </EraArt>
  );
}

function youtubeSearch(query: string) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

export function StepCard({
  step,
  language,
  caregiverLanguage,
  changed = false,
}: {
  step: SessionStep;
  language: string;
  caregiverLanguage: string;
  changed?: boolean;
}) {
  const t = getMessages().step;
  const Icon = STEP_ICON[step.kind];
  const searchable = step.kind === "listen" || step.kind === "look" || Boolean(step.mediaHint);
  return (
    <article
      className={cn(
        "grid overflow-hidden rounded-3xl border border-border bg-card shadow-paper sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-1 sm:p-4 print:block print:break-inside-avoid print:rounded-xl print:p-0 print:shadow-none",
        changed && "animate-flash ring-3 ring-ochre",
      )}
      data-testid="step-card"
      data-step-id={step.id}
      data-changed={changed || undefined}
      aria-labelledby={`step-${step.id}-title`}
    >
      <StepMedia step={step} className="h-32 border-b border-border sm:aspect-square sm:h-auto sm:rounded-2xl sm:border sm:shadow-paper print:hidden" />
      <div className="flex min-w-0 flex-col gap-3 p-5 sm:py-1 sm:pr-2 sm:pl-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="flex size-9 items-center justify-center rounded-full bg-primary font-heading font-semibold text-primary-foreground print:border print:border-current print:text-foreground" aria-hidden>
            {step.order + 1}
          </span>
          <span className="inline-flex items-center gap-1.5 font-semibold text-muted-foreground">
            <Icon className="size-5" aria-hidden />
            <span className="sr-only">{t.number(step.order + 1)}: </span>
            {t.kinds[step.kind]}
          </span>
          <span className="text-muted-foreground">· {t.minutes(step.durationMin)}</span>
          {changed && <Badge variant="ochre">{t.changed}</Badge>}
          <span className="ml-auto">
            <ProvenanceBadge step={step} />
          </span>
        </div>
        <h3 id={`step-${step.id}-title`} className="text-2xl leading-snug font-semibold">
          {step.title}
        </h3>
        <blockquote className="border-l-4 border-primary/70 pl-4">
          <p lang={language} className="font-heading text-xl leading-snug" style={{ fontVariationSettings: '"SOFT" 100, "opsz" 24' }}>
            “{step.prompt}”
          </p>
          {step.promptTranslation && (
            <p lang={caregiverLanguage} className="mt-1.5 text-muted-foreground">
              <span className="sr-only">{t.translation}: </span>
              {step.promptTranslation}
            </p>
          )}
        </blockquote>
        {step.followUps.length > 0 && (
          <div>
            <p className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">{t.followUps}</p>
            <ul className="mt-1 flex flex-col gap-1" lang={language}>
              {step.followUps.map((f) => (
                <li key={f} className="before:mr-2 before:text-primary before:content-['›']">
                  {f}
                </li>
              ))}
            </ul>
          </div>
        )}
        {step.caregiverTip && (
          <p className="flex gap-2.5 rounded-2xl bg-ochre-soft/60 px-4 py-3 text-[0.95rem]" lang={caregiverLanguage}>
            <LightbulbIcon className="mt-0.5 size-5 shrink-0 text-ochre-ink" aria-hidden />
            <span>
              <span className="sr-only">{t.tip}: </span>
              {step.caregiverTip}
            </span>
          </p>
        )}
        <div className="hidden flex-wrap items-center gap-x-6 gap-y-1 border-t border-dashed pt-2 text-sm print:flex" aria-hidden>
          <span className="font-semibold">{getMessages().print.reactions}</span>
          {(["lit_up", "neutral", "upset"] as const).map((r) => (
            <span key={r} className="inline-flex items-center gap-1.5">
              <span className="inline-block size-3.5 rounded-sm border border-current" />
              {getMessages().live.reactions[r]}
            </span>
          ))}
        </div>
        {searchable && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.95rem] text-muted-foreground print:hidden">
            {step.mediaHint && (
              <span className="inline-flex items-center gap-1.5">
                <SearchIcon className="size-4" aria-hidden />
                <span className="sr-only">{t.media}: </span>
                {step.mediaHint}
              </span>
            )}
            <a
              href={youtubeSearch(step.title)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full font-semibold text-primary underline-offset-4 hover:underline"
            >
              {t.searchMedia}
              <ExternalLinkIcon className="size-4" aria-hidden />
              <span className="sr-only">{t.opensInNewTab}</span>
            </a>
          </div>
        )}
      </div>
    </article>
  );
}
