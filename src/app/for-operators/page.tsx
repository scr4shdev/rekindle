import type { Metadata } from "next";
import Link from "next/link";
import {
  BuildingIcon,
  CalendarCheckIcon,
  CoinsIcon,
  SparklesIcon,
  TrendingUpIcon,
  UsersIcon,
} from "lucide-react";

export const metadata: Metadata = {
  title: "For care operators · Rekindle",
  description:
    "The buyer, the user, the pain in numbers, the pilot, the pricing and why Rekindle fits a cross-cultural care workforce right now.",
};

/**
 * A single scrollable brief for care-home and home-care operators. English-only
 * on purpose: the chrome stays in the caregiver's language, and this page
 * speaks to the person who signs the aide seats. Every number carries a public
 * source link or a visible hedge; nothing on this page should read as "we have
 * paying customers" because we do not.
 */
export default function ForOperatorsPage() {
  return (
    <main
      id="main"
      className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-5 pt-4 pb-20 sm:px-8"
    >
      <header className="flex flex-col gap-4">
        <OperatorMotif />
        <p className="text-[0.78rem] font-semibold tracking-[0.14em] text-sage uppercase">
          For care operators
        </p>
        <h1 className="animate-rise max-w-2xl text-[1.9rem] leading-[1.08] font-semibold sm:text-[2.4rem]">
          A reminiscence agent an aide can run bedside, in any culture, in one shift.
        </h1>
        <p className="animate-rise max-w-2xl text-muted-foreground sm:text-base">
          Rekindle is a planner for direct-care workers. It builds a 20-minute,
          culturally-grounded session the aide can read during handover and run
          with the person. Below is the shape of the business, with every claim
          sourced or hedged.
        </p>
      </header>

      <OperatorSection
        icon={UsersIcon}
        kicker="Two roles, one product."
        title="The buyer and the user"
      >
        <p>
          The <strong>buyer</strong> is a home-care agency or care-home operator
          who pays per aide seat. The <strong>user</strong> is the aide, called
          direct-care worker in the US, HCA in the UK, or EHPAD aide in France,
          depending on market. Family carers get a free tier: no login, no
          payment, no PII, forever. Keeping families free is a deliberate
          choice: it builds the recall habit the paid product then slots into.
        </p>
      </OperatorSection>

      <OperatorSection
        icon={TrendingUpIcon}
        kicker="A planning tax, charged once per shift, per aide."
        title="The pain in numbers"
      >
        <p>
          England alone has about <strong>1.59 million filled posts</strong> in
          adult social care, of which about <strong>1.03 million</strong> are
          frontline care workers.{" "}
          <SourceLink
            href="https://www.skillsforcare.org.uk/Adult-Social-Care-Workforce-Data/Workforce-intelligence/publications/national-information/The-state-of-the-adult-social-care-sector-and-workforce-in-England.aspx"
            label="Skills for Care, State of the adult social care sector in England 2024"
          />{" "}
          A growing share come from cross-cultural backgrounds, so an aide
          planning a reminiscence session cross-culturally today spends roughly
          10 to 20 minutes Googling, or defaults to generic Western classics
          that do not land. Multiply by shifts per week{" "}
          <Hedge>(directional; a pilot would confirm)</Hedge>.
        </p>
      </OperatorSection>

      <OperatorSection
        icon={SparklesIcon}
        kicker="Fifteen seconds on the replay path, under two minutes live."
        title="What Rekindle changes"
      >
        <p>
          The agent plans a 20-minute session in about{" "}
          <strong>15 seconds</strong> on the replay path, or{" "}
          <strong>90 to 125 seconds</strong> on the live path. The aide reads
          the plan during handover, runs it bedside with three big reaction
          buttons (lit up, quiet, upset), and closes with a warm overlay.
          Interface strings are in the aide&apos;s language; the prompts the
          aide speaks are in the person&apos;s language. No login, no database, no data
          leaves the device unless the aide chooses to share a plan.
        </p>
      </OperatorSection>

      <OperatorSection
        icon={CalendarCheckIcon}
        kicker="Nov to Dec 2026."
        title="The pilot calendar"
      >
        <p>
          <strong>50 sessions</strong>, caregiver-rated engagement score
          collected before and after each session. Target partner:
          Alzheimer&apos;s Society (UK), Alzheimer Scotland, or Playlist for Life, whichever
          responds first.{" "}
          <Hedge>
            Partner slot: in progress, charity outreach ongoing. Partner name
            goes here on confirmation.
          </Hedge>
        </p>
      </OperatorSection>

      <OperatorSection
        icon={CoinsIcon}
        kicker="A hypothesis, not a commitment."
        title="Pricing hypothesis"
      >
        <p>
          Per-aide SaaS seat for care-home and home-care operators,{" "}
          <strong>GBP 12 to 20 per aide per month</strong>. Free forever for
          family carers: no login, no PII, no payment.{" "}
          <Hedge>
            This is a hypothesis to be validated with the pilot, not a
            commitment.
          </Hedge>
        </p>
      </OperatorSection>

      <OperatorSection
        icon={BuildingIcon}
        kicker="A workforce shift, an evidence base and a graph that scales across cultures."
        title="Why now"
      >
        <ul className="flex flex-col gap-3">
          <li>
            <strong>a.</strong> A rising cross-cultural care workforce in the
            UK, EU and GCC: aides and the people they care for increasingly do
            not share era or culture.{" "}
            <SourceLink
              href="https://www.skillsforcare.org.uk/Adult-Social-Care-Workforce-Data/Workforce-intelligence/publications/national-information/The-state-of-the-adult-social-care-sector-and-workforce-in-England.aspx"
              label="Skills for Care 2024"
            />
          </li>
          <li>
            <strong>b.</strong> The non-pharma dementia intervention evidence
            base is strong: NICE guideline NG97 recommends offering activities
            tailored to the person&apos;s preferences, and Cochrane finds
            reminiscence has small but consistent effects on quality of life
            and communication.{" "}
            <SourceLink
              href="https://www.nice.org.uk/guidance/ng97"
              label="NICE NG97"
            />{" "}
            <SourceLink
              href="https://www.cochrane.org/CD001120/DEMENTIA_reminiscence-therapy-for-dementia"
              label="Cochrane review on reminiscence"
            />
          </li>
          <li>
            <strong>c.</strong> Qloo&apos;s taste graph lets us ship cross-cultural
            recall without manually curating catalogs per country. Every
            suggestion carries a provenance badge in-product.
          </li>
        </ul>
      </OperatorSection>

      <section
        className="rounded-3xl border border-border bg-paper-deep p-6 sm:p-8"
        aria-labelledby="operators-cta"
      >
        <h2
          id="operators-cta"
          className="text-xl font-semibold sm:text-2xl"
        >
          Rekindle is in private pilot.
        </h2>
        <p className="mt-2 text-muted-foreground">
          Operators, charities and researchers welcome.
        </p>
        <a
          href="mailto:pilot@rekindle.app"
          className="mt-5 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition hover:brightness-105 motion-reduce:transition-none"
          data-testid="operators-cta"
        >
          Email the team
        </a>
        <p className="mt-3 font-mono text-[0.72rem] text-muted-foreground">
          pilot@rekindle.app
        </p>
      </section>

      <nav aria-label="Related pages" className="text-sm text-muted-foreground">
        <Link
          href="/"
          className="underline-offset-4 hover:text-foreground hover:underline"
        >
          Back to the product
        </Link>
      </nav>
    </main>
  );
}

function OperatorSection({
  icon: Icon,
  kicker,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  kicker: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className="flex flex-col gap-3"
      aria-labelledby={`operators-${slug(title)}`}
    >
      <div className="flex items-center gap-3">
        <span
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-sage-soft text-sage-ink"
          aria-hidden
        >
          <Icon className="size-5" aria-hidden />
        </span>
        <h2
          id={`operators-${slug(title)}`}
          className="text-xl font-semibold text-sage-ink sm:text-2xl"
        >
          {title}
        </h2>
      </div>
      <p className="text-[0.9rem] text-muted-foreground sm:text-[0.95rem]">
        {kicker}
      </p>
      <div className="text-[0.95rem] leading-relaxed text-foreground sm:text-base">
        {children}
      </div>
    </section>
  );
}

function SourceLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-sage-ink underline underline-offset-2 hover:text-sage"
    >
      (Source: {label})
    </a>
  );
}

function Hedge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md bg-ochre-soft/60 px-1.5 py-0.5 font-mono text-[0.72rem] text-ochre-ink">
      {children}
    </span>
  );
}

/**
 * Decorative lamplight motif at the top of the page. CSS-only, reduced-motion
 * safe, same palette tokens as the rest of the product. No new assets.
 */
function OperatorMotif() {
  return (
    <div
      aria-hidden
      className="relative h-20 w-full overflow-hidden rounded-2xl border border-border bg-paper-deep"
    >
      <div
        className="absolute inset-0 opacity-80"
        style={{
          background:
            "repeating-linear-gradient(135deg, color-mix(in oklch, var(--sage) 18%, transparent) 0 12px, transparent 12px 28px)",
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 20% 50%, color-mix(in oklch, var(--ochre) 45%, transparent), transparent 55%)",
        }}
      />
    </div>
  );
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
