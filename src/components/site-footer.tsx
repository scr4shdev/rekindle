import { HeartHandshakeIcon, LockKeyholeIcon } from "lucide-react";
import Link from "next/link";
import { getMessages } from "@/i18n";

export function SiteFooter() {
  const t = getMessages().footer;
  return (
    <footer className="mt-auto border-t border-border bg-paper-deep print:hidden">
      <div className="mx-auto grid w-full max-w-6xl gap-6 px-5 py-10 text-[0.95rem] text-muted-foreground sm:px-8 md:grid-cols-2">
        <p className="flex gap-3">
          <HeartHandshakeIcon className="mt-1 size-5 shrink-0 text-primary" aria-hidden />
          <span>{t.disclaimer}</span>
        </p>
        <div className="space-y-3">
          <p className="flex gap-3">
            <LockKeyholeIcon className="mt-1 size-5 shrink-0 text-sage" aria-hidden />
            <span>{t.privacy}</span>
          </p>
          <p className="pl-8">{t.qloo}</p>
          <p className="pl-8">{t.credit}</p>
          <p className="pl-8">
            <Link
              href="/for-operators"
              className="underline-offset-4 hover:text-foreground hover:underline"
              data-testid="footer-for-operators"
            >
              For care operators
            </Link>
          </p>
        </div>
      </div>
    </footer>
  );
}
