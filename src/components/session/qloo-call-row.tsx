import { ChevronRightIcon, DatabaseZapIcon } from "lucide-react";
import { getMessages } from "@/i18n";
import type { QlooCallRecord } from "@/lib/domain/types";

function formatValue(value: QlooCallRecord["params"][string]): string {
  return Array.isArray(value) ? value.join(", ") : String(value);
}

/** The most telling parameter for the one-line summary. */
function headline(call: QlooCallRecord): string {
  const p = call.params;
  const pick = p.query ?? p["filter.type"] ?? p["filter.tag.types"] ?? Object.values(p)[0];
  return pick === undefined ? "" : formatValue(pick).replace("urn:entity:", "");
}

/**
 * One Qloo request: endpoint, key parameter and result count, expandable to
 * every parameter as sent. This is the request-to-result evidence.
 */
export function QlooCallRow({ call }: { call: QlooCallRecord }) {
  const tr = getMessages().trace;
  const entries = Object.entries(call.params);
  return (
    <details className="group rounded-xl border border-border bg-paper-deep" data-testid="qloo-call">
      <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-2 text-[0.9rem] [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon className="size-4 shrink-0 transition-transform group-open:rotate-90" aria-hidden />
        <DatabaseZapIcon className="size-4 shrink-0 text-ochre" aria-hidden />
        <span className="sr-only">{tr.qlooRequest}:</span>
        <code className="font-mono font-bold">GET {call.endpoint}</code>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{headline(call)}</span>
        <span className="ml-auto text-right text-muted-foreground tabular-nums">
          {tr.results(call.resultCount)} · {Math.round(call.durationMs)} ms
        </span>
      </summary>
      <div className="border-t border-border px-3 py-2">
        <p className="mb-2 text-xs font-semibold text-muted-foreground">
          {tr.params}
          {" · "}
          {call.source === "mock" ? tr.mock : tr.live_}
          {call.cached && ` · ${tr.cached}`}
        </p>
        <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-1 font-mono text-[0.8rem]">
          {entries.map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="text-muted-foreground">{key}</dt>
              <dd className="break-words">{formatValue(value)}</dd>
            </div>
          ))}
        </dl>
      </div>
    </details>
  );
}
