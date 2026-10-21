import type { Metadata } from "next";
import { Suspense, use } from "react";
import { PrintSessionCard } from "@/components/print/print-session-card";
import { getMessages } from "@/i18n";

const t = getMessages().print;

export const metadata: Metadata = { title: `${t.printTitle} · Rekindle` };

/**
 * Printable one-page session card. The id is the persona slug (maria, seamus,
 * fatima) or "custom" (which reads the pending-request memory in the current
 * tab, exactly like /session). Nothing is fetched server-side: the plan is
 * streamed by the same client source /session uses.
 */
export default function PlanPrintPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <main id="main" className="flex-1">
      <Suspense fallback={null}>
        <PrintCardFromParams params={params} />
      </Suspense>
    </main>
  );
}

function PrintCardFromParams({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <PrintSessionCard id={id} />;
}
