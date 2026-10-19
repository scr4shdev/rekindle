import { ChevronRightIcon, DatabaseZapIcon } from "lucide-react";
import { getMessages } from "@/i18n";
import type { QlooCallRecord, VerifiedEntity } from "@/lib/domain/types";

function formatValue(value: QlooCallRecord["params"][string]): string {
  return Array.isArray(value) ? value.join(", ") : String(value);
}

/** Resolve a list of seed qloo ids to human names via the trace's entity map. */
function resolveSeedNames(seeds: unknown, entities: Record<string, VerifiedEntity>): string[] {
  const ids = Array.isArray(seeds) ? seeds : typeof seeds === "string" ? seeds.split(",") : [];
  return ids
    .map((id) => (typeof id === "string" ? entities[id.trim()]?.name : undefined))
    .filter((n): n is string => Boolean(n));
}

function yearSpan(params: QlooCallRecord["params"]): { start?: string | number; end?: string | number } {
  return { start: params["filter.release_year.min"] as string | number | undefined, end: params["filter.release_year.max"] as string | number | undefined };
}

/**
 * A one-line inner voice reading of a Qloo call: what the agent is actually
 * trying to learn, not the HTTP shape. Falls back to the raw query if nothing
 * cleaner can be said.
 */
export function narration(call: QlooCallRecord, entities: Record<string, VerifiedEntity>): string {
  const tr = getMessages().trace;
  const p = call.params;
  if (call.endpoint === "/v2/insights") {
    const seedNames = resolveSeedNames(p["signal.interests.entities"], entities);
    const { start, end } = yearSpan(p);
    if (seedNames.length === 0) {
      // Fall through to the generic branch below.
    } else if (start !== undefined && end !== undefined) {
      return tr.narrationInsights(seedNames.join(", "), start, end);
    } else if (start === undefined && end === undefined) {
      // No year window (e.g. artist insights): just name the taste seeds.
      return tr.narrationInsightsNoYears(seedNames.join(", "));
    } else {
      // One edge of the window is missing: say "up to today" rather than
      // printing an awkward en-dash between English words like "any era–today".
      return tr.narrationInsightsOpenEnd(seedNames.join(", "));
    }
  }
  if (call.endpoint === "/v2/tags" && typeof p.query === "string") {
    return tr.narrationTags(p.query);
  }
  // /search and the fallback: humanise the query if present.
  const q = p.query ?? p["filter.type"] ?? Object.values(p)[0];
  const value = q === undefined ? "" : formatValue(q).replace("urn:entity:", "");
  return value ? tr.narrationSearch(value) : "";
}

/**
 * One Qloo request as a line of the agent's inner voice. The endpoint hides
 * in the open details so it reads as "what the agent is checking", not a GET
 * log line.
 */
export function QlooCallRow({ call, entities = {} }: { call: QlooCallRecord; entities?: Record<string, VerifiedEntity> }) {
  const tr = getMessages().trace;
  const entries = Object.entries(call.params);
  return (
    <details className="group rounded-xl border border-border bg-paper-deep" data-testid="qloo-call">
      <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-2 text-[0.9rem] [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon className="size-4 shrink-0 transition-transform group-open:rotate-90" aria-hidden />
        <DatabaseZapIcon className="size-4 shrink-0 text-ochre" aria-hidden />
        <span className="sr-only">{tr.qlooRequest}:</span>
        <span className="min-w-0 flex-1 truncate">{narration(call, entities)}</span>
        <span className="ml-auto shrink-0 text-right text-muted-foreground tabular-nums">
          {tr.results(call.resultCount)} · {Math.round(call.durationMs)} ms
        </span>
      </summary>
      <div className="border-t border-border px-3 py-2">
        <p className="mb-2 text-xs font-semibold text-muted-foreground">
          <code className="font-mono">GET {call.endpoint}</code>
          {" · "}
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
