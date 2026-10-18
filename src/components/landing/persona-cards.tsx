import { ArrowRightIcon, ClockIcon, LanguagesIcon } from "lucide-react";
import Link from "next/link";
import { EraArt, type EraMotif } from "@/components/era-art";
import { getMessages } from "@/i18n";
import { PERSONAS, type DemoPersona } from "@/lib/personas";

const MOTIF: Record<DemoPersona["slug"], EraMotif> = { maria: "awning", seamus: "tweed", fatima: "zellige" };

const decade = (year: number) => `${Math.floor(year / 10) * 10}s`;

/** Language and region display names, in the caregiver language. */
function displayName(type: "language" | "region", code: string, uiLang = "en"): string {
  try {
    return new Intl.DisplayNames([uiLang], { type }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function PersonaCards() {
  const t = getMessages().landing;
  return (
    <ul className="grid gap-5 md:grid-cols-3" aria-label={t.personasTitle}>
      {PERSONAS.map((persona, i) => {
        const { input, card } = persona;
        const birthYear = input.birthYear ?? 1945;
        const first = card.name.split(",")[0];
        return (
          <li key={persona.slug} className="animate-rise" style={{ animationDelay: `${120 + i * 90}ms` }}>
            <Link
              href={`/session?persona=${persona.slug}`}
              data-testid={`persona-${persona.slug}`}
              className="group flex h-full flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-paper transition-[transform,box-shadow] duration-300 hover:-translate-y-1 hover:shadow-lift focus-visible:-translate-y-1"
            >
              <EraArt motif={MOTIF[persona.slug]} className="h-20 border-b border-border sm:h-32">
                <span className="absolute bottom-2.5 left-4 rounded-full bg-card/95 px-3 py-1 font-heading text-lg font-semibold shadow-paper">
                  {t.era(decade(birthYear + 12), decade(birthYear + 25))}
                </span>
                <span className="absolute top-3 right-4 rounded-full bg-card/95 px-3 py-1 text-sm font-semibold shadow-paper">
                  {displayName("region", card.flag)}
                </span>
              </EraArt>
              <div className="flex flex-1 flex-col gap-2 p-5 sm:gap-3 sm:p-6">
                <h3 className="text-2xl font-semibold sm:text-3xl">{card.name}</h3>
                <p className="text-lg leading-snug text-muted-foreground">{card.tagline}</p>
                <div className="mt-auto flex flex-wrap gap-x-4 gap-y-1 pt-2 text-[0.95rem] text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <LanguagesIcon className="size-4" aria-hidden />
                    {t.sessionIn(displayName("language", input.sessionLanguage ?? "en"))}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <ClockIcon className="size-4" aria-hidden />
                    {t.minutes(input.sessionMinutes ?? 20)}
                  </span>
                </div>
                <span className="mt-2 inline-flex h-12 items-center justify-between rounded-full bg-primary px-5 font-semibold text-primary-foreground transition-colors group-hover:bg-[color-mix(in_oklch,var(--primary),var(--foreground)_14%)]">
                  {t.openSession(first)}
                  <ArrowRightIcon className="size-5 transition-transform group-hover:translate-x-1" aria-hidden />
                </span>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
