import type { Metadata } from "next";
import { Suspense } from "react";
import { SessionView } from "@/components/session/session-view";

export const metadata: Metadata = { title: "Session · Rekindle" };

export default function SessionPage() {
  return (
    <main id="main" className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 pt-2 pb-16 sm:px-8">
      <Suspense fallback={<div className="h-96 animate-pulse rounded-3xl bg-muted" aria-hidden />}>
        <SessionView />
      </Suspense>
    </main>
  );
}
