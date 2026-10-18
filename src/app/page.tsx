import { HeartHandshakeIcon, LockKeyholeIcon, SearchCheckIcon } from "lucide-react";
import { CustomForm } from "@/components/landing/custom-form";
import { PersonaCards } from "@/components/landing/persona-cards";
import { getMessages } from "@/i18n";

export default function Home() {
  const t = getMessages().landing;
  const promises = [
    { icon: LockKeyholeIcon, text: t.promises.stored, tone: "bg-sage-soft text-sage-ink" },
    { icon: HeartHandshakeIcon, text: t.promises.activity, tone: "bg-rose-soft text-rose-ink" },
    { icon: SearchCheckIcon, text: t.promises.grounded, tone: "bg-ochre-soft text-ochre-ink" },
  ];
  return (
    <main id="main" className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-5 pt-2 pb-20 sm:gap-12 sm:px-8 sm:pt-4">
      <section className="flex flex-col gap-4 sm:gap-5" aria-labelledby="hero-title">
        <h1 id="hero-title" className="animate-rise max-w-4xl text-[2rem] leading-[1.05] font-semibold sm:text-[3.4rem]">
          {t.title}
        </h1>
        <p className="animate-rise max-w-4xl text-muted-foreground sm:text-xl">{t.leadShort}</p>
        <ul className="animate-rise flex flex-wrap gap-2 sm:gap-2.5">
          {promises.map(({ icon: Icon, text, tone }) => (
            <li key={text} className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-[0.85rem] font-semibold sm:px-4 sm:py-2 sm:text-base ${tone}`}>
              <Icon className="size-4 sm:size-5" aria-hidden />
              {text}
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-4 sm:gap-5" aria-labelledby="personas-title">
        <div className="flex flex-col gap-x-4 gap-y-1 sm:flex-row sm:items-baseline">
          <h2 id="personas-title" className="text-2xl font-semibold sm:text-3xl">
            {t.personasTitle}
          </h2>
          <p className="hidden text-muted-foreground sm:block">{t.personasLead}</p>
        </div>
        <PersonaCards />
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="custom-title" id="custom">
        <div className="flex flex-col gap-1">
          <h2 id="custom-title" className="text-2xl font-semibold sm:text-3xl">
            {t.customTitle}
          </h2>
          <p className="text-muted-foreground">{t.customLead}</p>
        </div>
        <CustomForm />
      </section>

      <section aria-labelledby="how-title" className="rounded-3xl border border-border bg-paper-deep p-6 sm:p-8">
        <h2 id="how-title" className="mb-5 text-2xl font-semibold">
          {t.howTitle}
        </h2>
        <ol className="grid gap-6 md:grid-cols-3">
          {t.how.map((step, i) => (
            <li key={step.title} className="flex gap-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary font-heading text-lg font-semibold text-primary-foreground">
                {i + 1}
              </span>
              <div>
                <h3 className="text-xl font-semibold">{step.title}</h3>
                <p className="text-muted-foreground">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
