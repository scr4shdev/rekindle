# Rekindle

A tool-using agent that helps a caregiver plan a 20-minute reminiscence activity for someone they love who is living with dementia, with every cultural reference verified against Qloo's taste graph so it fits the person's era, place, and language.

Built for the Qloo Agentic Hackathon (submission deadline 2026-10-30). Non-medical: an activity planner, not therapy, not treatment, not diagnosis.

## The six-phase agent loop

```
caregiver notes
      │
      ▼
┌───────────┐   ┌───────────┐   ┌───────────┐   ┌───────────┐   ┌───────────┐   ┌───────────┐
│   PARSE   │ → │  PROPOSE  │ → │  VERIFY   │ → │  EXPAND   │ → │ CRITIQUE  │ → │  COMPOSE  │
│   (LLM)   │   │   (LLM)   │   │  (Qloo)   │   │  (Qloo)   │   │   (LLM)   │   │   (LLM)   │
└───────────┘   └───────────┘   └───────────┘   └───────────┘   └───────────┘   └───────────┘
   anchors         candidates     verified +      cross-domain     anachronism,     timed session
   (era,           per domain     rejected        affinities        wrong-locale,    with prompts
   locale,         with Qloo      per candidate   from verified     emotional-risk   in the person's
   loves,          type hint      (exact match    seeds, filtered   drops            own language
   sensitivities)                  or match-      to the formative
                                  entity LLM)     window

                       all events stream as NDJSON to the UI
                              │
                              ▼
                        caregiver taps: lit up / quiet / upset  →  REPLAN (LLM + Qloo)
```

Each phase emits stamped `AgentEvent`s (phase start/complete, note, candidate, verified, rejected, qloo_call, step, plan, error, done) on a single NDJSON stream. The caregiver watches the reasoning as it happens: what was proposed, what Qloo confirmed, what was rejected and why.

## Try it

- **Live demo:** TODO: link (hosted deploy pending).
- **Judge-stable fixture (no Qloo, no LLM, under 15 seconds):** `/session?persona=maria&source=replay` streams a committed trace file. Byte-stable across runs.
- **Local run** (fully in mock mode, no keys needed):

  ```bash
  export PATH="$HOME/.nvm/versions/node/v24.22.0/bin:$PATH"
  npm ci
  npm run dev          # http://localhost:3000
  ```

The three one-tap personas are **Maria** (Naples, Italian), **Fatima** (Fès and Brussels, French and Arabic) and **Seamus** (Cork, English and Irish). Deliberately chosen: Fatima stress-tests Qloo's Western-dataset drift.

## What Qloo does here

Qloo is used as a **cultural taste graph that verifies against period, place, and culture**, not as a recommender shown to the caregiver. Specific moves:

- **Verify every LLM idea exists** via `GET /search`, then pull id, image and release year. Fails are tagged (`not_found`, `wrong_locale`, `wrong_era`) and surfaced in the live trace, not hidden.
- **Expand from verified seeds** via `GET /v2/insights` with era filters dispatched per type (`filter.release_year.*` for film/TV, `filter.date_of_birth.*` for people, decade tags for music where no year filter exists). The dispatch table lives in `src/lib/ports/taste.ts` as `ERA_FILTER_SUPPORT`.
- **Cuisine-tag side-lookup for food** (`GET /v2/tags`): food has no dish type, so a candidate like "Sunday ragù" is kept as a caregiver-led idea only when its cuisine tag resolves; otherwise the food step is dropped gracefully instead of surfacing airport restaurants.
- **Location-drop fallback on empty insights**: if a request combined `signal.location.query` and `filter.tags` and returned zero items, retry once without the location, then once without the tag filter. Recovered Maria's music discovery from 0 results to 1 in the live probe.
- **Cultural-mismatch LLM pass** for non-Western personas: Qloo's Western-leaning expand output goes through a `cultural-check` prompt that drops obvious extrapolations (Donald Trump no longer surfaces for Fatima). Rejections appear in the trace with the "Doesn't fit culture" badge.
- **Provenance badges on every step**: `qloo-grounded` (built around a verified entity), `qloo-affinity` (from expand), or `llm-only` (no verified entity in the step). The caregiver can tell at a glance what Qloo touched and what it did not.

Qloo results are always framed in the UI as aggregate affinities: *"people who enjoy Frank Sinatra and Renato Carosone also tend to enjoy Peppino di Capri"*, never *"Maria will like Peppino di Capri"*.

## Why hybrid, not LLM alone

Ask any frontier LLM to plan a reminiscence session for a 1950s Neapolitan grandmother and it will cheerfully include "Napoli Mia Bella, 1957" (a hallucinated-but-plausible song title) and Maradona's 1987 scudetto. It feels right. It is wrong: the first song does not exist, and the second belongs to a decade when Maria was 45 and had emigrated. Those are exactly the slips a caregiver cannot afford.

The hybrid loop catches them in two different places. **Verify** sends every proposed entity to Qloo's `/search`; "Napoli Mia Bella" fails to resolve and is marked `not_found` in the live trace. **Critique** then runs a separate LLM pass over everything that survived verify, scoring each item for anachronism, wrong-locale, cultural mismatch and emotional risk; Maradona 1987 fails the era check and is dropped. The **Compare** page (`src/components/compare/compare-view.tsx`, 316 lines) runs both plans side by side and marks every LLM-only step that a grounded rejection matched with a "would have slipped" badge, with the specific Qloo rejection quoted on the right.

The point is not that Qloo "has the right answer". The point is that **the LLM proposes, Qloo verifies against a cultural ground truth it could not invent, and the LLM then critiques for the things Qloo cannot judge (framing, culture, risk)**. Each tool does what it is best at.

## Architecture

- **Ports and adapters.** The agent in `src/lib/agent/` depends only on three ports (`TastePort`, `LlmPort`, `CachePort` in `src/lib/ports/`), with ESLint boundaries enforcing the direction. Qloo, LLM providers (Gemini, Groq, Anthropic, Ollama) and cache (memory, Upstash, layered) are swappable adapters wired by `src/lib/composition.ts`.
- **Six phases.** `src/lib/agent/session.ts` runs PARSE → PROPOSE → VERIFY → EXPAND → CRITIQUE → COMPOSE as an `AsyncGenerator<AgentEvent>`. Replan is a separate loop (`src/lib/agent/replan.ts`) that takes a reaction and rewrites upcoming steps.
- **Determinism contract.** Temperature 0, pinned model IDs, seven versioned prompt modules in `src/lib/prompts/` (each exports `ID` and `VERSION`), an input-keyed sha256 cache (`buildCacheKey`), and injected `now` / `newId` on `AgentDeps` instead of ambient `Date.now()` / `nanoid`. The three persona traces replay byte-identical: see `tests/fixtures/trace-*.ndjson` with sha256 pinned in the `.meta.json` sibling.

Deeper tour: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). HTTP contract: [`docs/api.md`](docs/api.md). Qloo field notes: [`docs/qloo-api.md`](docs/qloo-api.md). Judge tour: [`docs/judges.md`](docs/judges.md).

## Privacy posture

Privacy is a product value here, not an afterthought.

- **No personal data ever reaches Qloo.** `withPersonalDataGuard(port, personalTermsFromDisplayName(person.displayName))` wraps every Qloo request and refuses the call if any personal term from the person's display name appears in the payload. Only public cultural anchors (entity names and ids, tag ids, place names, years, an aggregate age bucket) are allowed through. Enforced in code (`src/lib/ports/taste.ts`), not by policy.
- **Caregiver notes are never logged and never cached in plaintext.** Cache keys are sha256 hashes. Results derived from notes (the PARSE phase output) carry `sensitive: true` and stay in process memory only; they never reach Upstash.
- **No login, no database, no stored session.** Each request carries the whole state it needs. The custom-form draft optionally autosaves to `sessionStorage` on that one tab, cleared on submit.
- **Local Ollama fallback as a trust story.** With `qwen3:8b` reachable at `127.0.0.1:11434`, Rekindle auto-wires to the local model when no hosted LLM key is set. The product keeps working offline, byte-deterministic (seed 42), on a 6 GB consumer GPU. That matters in a care context where you may not want to send a stranger's intimate notes to a third-party API at all.

The Qloo API key is read only by `src/lib/config.ts` and used only in the Qloo adapter from server-side route handlers. It is never printed, never logged, never embedded in a `NEXT_PUBLIC_*` variable, and never shipped to the client.

## Social good

Rekindle is framed carefully.

- **Non-medical.** It plans an activity, not therapy. Copy avoids "treatment", "diagnosis" and "therapy". The disclaimer in the footer says so explicitly.
- **Person-first language.** "Someone living with dementia", never "a dementia patient". "Reactions", not "symptoms". The three bedside buttons are **Lit up**, **Quiet**, **Upset**: no clinical scoring.
- **Caregiver-centered.** The caregiver (family member, aide, carer) is the user. The chrome, the trace narration and the plan content speak the caregiver's language; the prompts and media are in the person's own language. UI copy is deliberately warm, not clinical: Lamplight palette (oat ground, sage primary, warm amber accents), humanist type, no hospital-blue anywhere.
- **Three personas, chosen on purpose.** Maria (Italian), Fatima (French and Arabic, Moroccan), Seamus (English and Irish). Fatima is the hard case: non-Western, bilingual, with a childhood in Fès and adult life in Brussels. If the loop works for her, it works.

## Development

```bash
export PATH="$HOME/.nvm/versions/node/v24.22.0/bin:$PATH"
npm run dev            # http://localhost:3000, mock mode without keys
npm run check          # typecheck + lint + unit/contract tests + production build
npm test               # vitest (209 unit tests across 26 files at this writing)
npx playwright install chromium && npm run e2e   # browser tests, always mock mode, port 3100
REKINDLE_FORCE_MOCK=true npm run dev   # force mocks even with keys set
```

### Live mode

Copy `.env.example` to `.env.local` and fill the keys you have. Each provider switches to live mode independently when its key is set.

| Variable | Purpose | Default |
|---|---|---|
| `QLOO_API_KEY` | Qloo Insights API key (server-side only) | empty: mock Qloo |
| `QLOO_BASE_URL` | Qloo host | `https://hackathon.api.qloo.com` |
| `LLM_PROVIDER` | `gemini`, `groq`, `anthropic`, `ollama` or `mock` | first provider with a key, else local Ollama if reachable, else mock |
| `LLM_MODEL` | Override the pinned model | per provider (see `src/lib/config.ts`) |
| `GEMINI_API_KEY` / `GROQ_API_KEY` / `ANTHROPIC_API_KEY` | LLM provider keys | empty |
| `OLLAMA_BASE_URL` / `OLLAMA_MODEL` | Local Ollama endpoint and model id | `http://127.0.0.1:11434`, `qwen3:8b` |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Shared cache across serverless instances | empty: in-memory cache |
| `REKINDLE_FORCE_MOCK` | Force mocks even when keys are set | `false` |
| `LOG_LEVEL` | pino level | `info` |

All variables and limits: [`.env.example`](.env.example). API contract: [`docs/api.md`](docs/api.md). Qloo API notes: [`docs/qloo-api.md`](docs/qloo-api.md). Submission checklist: [`docs/submission-requirements.md`](docs/submission-requirements.md).

## Limitations

- Not a medical device and not therapy. It suggests activities; the caregiver decides. Stop if the person is uncomfortable.
- Qloo affinities are aggregate and say nothing certain about any one individual. Coverage of some regions and eras may be thin, especially outside the Anglophone West.
- Qloo has no dish type and no year filter for music artists, so food steps are LLM-only (gated by a cuisine-tag side-lookup) and music era checks use decade tags plus the LLM critique.
- LLM mistakes are reduced (verification, critique, provenance badges) but not eliminated.

## License

TBD.
