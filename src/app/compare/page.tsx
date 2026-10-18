import type { Metadata } from "next";
import { Suspense } from "react";
import { CompareView } from "@/components/compare/compare-view";

export const metadata: Metadata = { title: "Compare · Rekindle" };

export default function ComparePage() {
  return (
    <main id="main" className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 pt-2 pb-16 sm:px-8">
      <Suspense fallback={<div className="h-96 animate-pulse rounded-3xl bg-muted" aria-hidden />}>
        <CompareView />
      </Suspense>
    </main>
  );
}
