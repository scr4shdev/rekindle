/**
 * Landing-page service-posture panel: a calm, read-only summary of what each
 * side of Rekindle sees. Verified against code in this repo today:
 *
 * - "Qloo sees" lists only what the strict schemas in `src/lib/ports/taste.ts`
 *   allow: public cultural entity names, Qloo tag ids (urn:tag:...), public
 *   place names (city-level, via `signal.location.query`), and an aggregate
 *   age bucket (via `signal.demographics.age`). The display name is blocked
 *   by `withPersonalDataGuard` before any query leaves the server.
 * - "The language model sees" reflects that the caregiver's free notes travel
 *   from the API route handler to the pinned model and back. They are not
 *   persisted and are not logged (see AGENTS.md: no `console.*`, no notes in
 *   logs; `sensitive: true` on PARSE outputs keeps them in process memory).
 * - "Stays on this device" reflects `src/lib/feedback-store.ts`
 *   (sha256-keyed localStorage for per-person reactions) and the print-card
 *   handoff via sessionStorage.
 *
 * Server component. No new runtime dependencies. No regex over LLM text. No
 * personal data in the copy. The HTML `<details>` element gives us an
 * accessible collapsible without client-side state.
 */
import { getMessages } from "@/i18n";

export function DataFlowsPanel() {
  const t = getMessages().dataFlows;
  const columns = [
    { key: "qloo", title: t.qlooSeesTitle, body: t.qlooSeesBody, Icon: QlooIcon },
    { key: "llm", title: t.llmSeesTitle, body: t.llmSeesBody, Icon: LlmIcon },
    { key: "device", title: t.deviceOnlyTitle, body: t.deviceOnlyBody, Icon: DeviceIcon },
  ] as const;
  return (
    <section aria-labelledby="data-flows-title" className="animate-rise">
      <details
        data-testid="data-flows-panel"
        className="group rounded-2xl border border-sage/30 bg-sage-soft/40 open:bg-sage-soft/60"
      >
        <summary
          data-testid="data-flows-toggle"
          className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-5 py-3 text-sage-ink hover:bg-sage-soft/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sage sm:px-6"
        >
          <h2 id="data-flows-title" className="text-base font-semibold sm:text-lg">
            {t.heading}
          </h2>
          <span className="inline-flex items-center gap-2 text-sm font-medium text-sage-ink/80">
            <span aria-hidden className="hidden sm:inline">
              {t.openLabel}
            </span>
            <ChevronIcon />
          </span>
        </summary>
        <div className="grid gap-4 px-5 pt-1 pb-5 sm:grid-cols-3 sm:gap-5 sm:px-6 sm:pb-6">
          {columns.map(({ key, title, body, Icon }) => (
            <article key={key} className="flex flex-col gap-2" data-testid={`data-flows-col-${key}`}>
              <div className="inline-flex size-7 items-center justify-center rounded-full bg-sage-soft text-sage-ink">
                <Icon />
              </div>
              <h3 className="text-sm font-semibold text-sage-ink sm:text-[0.95rem]">{title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
            </article>
          ))}
        </div>
      </details>
    </section>
  );
}

// Inline SVGs: outlined, 20 px, currentColor. No new icon dependency.
function QlooIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
      <circle cx="6" cy="6" r="2.2" />
      <circle cx="18" cy="6" r="2.2" />
      <circle cx="12" cy="18" r="2.2" />
      <path d="M7.6 7.4l3 8.3" />
      <path d="M16.4 7.4l-3 8.3" />
      <path d="M8 6h8" />
    </svg>
  );
}

function LlmIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
      <rect x="3.5" y="4" width="17" height="10" rx="2.4" />
      <path d="M8 18h8" />
      <path d="M12 14v4" />
      <circle cx="8.5" cy="9" r="0.9" />
      <circle cx="12" cy="9" r="0.9" />
      <circle cx="15.5" cy="9" r="0.9" />
    </svg>
  );
}

function DeviceIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
      <rect x="6.5" y="3.5" width="11" height="17" rx="2.4" />
      <path d="M10.5 17.5h3" />
      <path d="M9.5 7.5h5" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false" className="transition-transform group-open:rotate-180">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
