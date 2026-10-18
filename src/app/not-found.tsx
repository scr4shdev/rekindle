import Link from "next/link";
import { EraArt } from "@/components/era-art";
import { buttonVariants } from "@/components/ui/button";
import { getMessages } from "@/i18n";

export default function NotFound() {
  const t = getMessages().notFound;
  return (
    <main id="main" className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-start gap-6 px-5 py-12 sm:px-8">
      <EraArt motif="stamp" className="h-28 w-full rounded-3xl border border-border shadow-paper" />
      <h1 className="text-4xl font-semibold">{t.title}</h1>
      <p className="text-lg text-muted-foreground">{t.body}</p>
      <Link href="/" className={buttonVariants({ size: "lg" })}>
        {t.home}
      </Link>
    </main>
  );
}
