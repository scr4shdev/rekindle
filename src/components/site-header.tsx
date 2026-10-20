import Link from "next/link";
import { LogoMark } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { getMessages } from "@/i18n";

export function SiteHeader() {
  const t = getMessages().app;
  return (
    <header className="print:hidden">
      <a
        href="#main"
        className="sr-only z-50 rounded-full bg-primary px-5 py-3 font-semibold text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        {t.skipToContent}
      </a>
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-2 px-4 py-4 sm:gap-4 sm:px-8">
        <Link
          href="/"
          className="group flex min-w-0 items-center gap-2 rounded-full pr-2 sm:gap-3 sm:pr-3"
          aria-label={`${t.name}, ${t.nav.home}`}
        >
          <LogoMark className="size-9 shrink-0 transition-transform duration-300 group-hover:-rotate-6 sm:size-10" />
          <span className="truncate font-heading text-xl font-semibold tracking-tight sm:text-2xl">{t.name}</span>
        </Link>
        <nav className="flex shrink-0 items-center gap-1" aria-label={t.nav.label}>
          <Link
            href="/compare?persona=maria"
            className="inline-flex h-11 items-center rounded-full px-2.5 font-semibold text-muted-foreground hover:bg-muted hover:text-foreground sm:px-4"
          >
            {t.nav.compare}
          </Link>
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
