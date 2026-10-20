# Rekindle architecture

A technical tour for the judge who wants to look under the hood. Written against `main` at the current head.

Rekindle is a Next.js 16.4 (App Router, Turbopack, `cacheComponents: true`), React 19.3, Tailwind v4, TypeScript app with a stateless serverless backend (one NDJSON streaming route handler) and a hybrid LLM + Qloo agent in `src/lib/`. Every semantic judgment runs through a schema-validated LLM call; deterministic code only reshapes already-structured data. There is no database.

## The six-phase agent loop

Entry point: `src/lib/agent/session.ts#runSession`. The agent is an `AsyncGenerator<AgentEvent>` that `src/app/api/session/route.ts` pipes to NDJSON. Each phase emits a `phase{status:"started"}`, then its own events, then `phase{status:"completed"}` with `durationMs` and `counts`.

| # | Phase | LLM prompt (in `src/lib/prompts/`) | Qloo endpoints | Emits (`AgentEvent`) |
|---|---|---|---|---|
| 1 | **PARSE** | `parse-anchors` (v1.0.0) | none | `phase`, `note`, `anchors` |
| 2 | **PROPOSE** | `propose-candidates` (v1.0.0) | none | `phase`, `note`, `candidate` |
| 3 | **VERIFY** | `match-entity` (v1.0.0), only on fuzzy fallback | `GET /search` per candidate | `phase`, `qloo_call`, `verified`, `rejected{kind:not_found}` |
| 4 | **EXPAND** | none | `GET /v2/insights` per verified-type cluster, `GET /v2/tags` for cuisine side-lookup | `phase`, `qloo_call`, `verified{provenance:qloo-affinity}` |
| 5 | **CRITIQUE** | `critique-items` (v1.0.0) and `cultural-check` (v1.0.0, non-Western only) | none | `phase`, `rejected{kind:anachronism|wrong_locale|emotional_risk|duplicate}` |
| 6 | **COMPOSE** | `compose-session` (v1.0.0) | none | `phase`, `step`, `plan` |

Replan is a separate loop in `src/lib/agent/replan.ts` using `replan-session` (v1.1.0). Past steps are frozen; upcoming steps are rewritten reaction-aware, keyed by caregiver language.

The six phases are glued together in `session.ts`:

```ts
const { anchors, privateNames } = yield* parsePhase(run, person);
// privateNames found in notes (e.g. family) extend the personal-data guard
const candidates = yield* proposePhase(run, anchors, person, llmOnly);
materials = llmOnly ? candidates.map(ideaMaterial) : yield* verifyPhase(run, anchors, candidates);
if (!llmOnly) materials = [...materials, ...(yield* expandPhase(run, anchors, materials))];
const kept = yield* critiquePhase(run, anchors, person, materials);
yield* composePhase(run, anchors, person, mode, kept, rejectedRefs);
```

Each `yield* phase(...)` returns the structured output the next phase needs and emits its own events on the way.

### LLM-only mode

The same `runSession` with `mode: "llm-only"` emits VERIFY and EXPAND as `phase{status:"skipped"}` and uses `ideaMaterial(candidate)` for every step. The Compare page runs both modes on the same notes and diffs the result. This is where "would have slipped" badges come from.

## Ports and adapters

Three ports in `src/lib/ports/`, all frozen after Phase 0:

```
                 ┌───────────────────────────────┐
                 │   src/lib/agent/*  (loop)     │
                 │                               │
                 │   session.ts, replan.ts,      │
                 │   run.ts, phases/*            │
                 └──────────┬───────────┬────────┘
                            │           │
                            ▼           ▼
                      ┌──────────┐ ┌──────────┐ ┌──────────┐
                      │TastePort │ │ LlmPort  │ │CachePort │
                      └────┬─────┘ └────┬─────┘ └────┬─────┘
                           │            │            │
            ┌──────────────┼────────────┼────────────┼──────────────┐
            │              │            │            │              │
       QlooHttp         MockQloo    AiSdkLlm      OllamaLlm      MockLlm
      MemoryCache    LayeredCache   UpstashCache
```

- **TastePort** (`src/lib/ports/taste.ts`): `search`, `insights`, `tagSearch`, `lookup`. Zod-strict query schemas; `withPersonalDataGuard(port, forbiddenTerms)` wraps every instance before the agent sees it (HARD RULE 2 in `AGENTS.md`).
- **LlmPort** (`src/lib/ports/llm.ts`): `generateObject<T>({ promptId, version, schema, system, input, sensitive? })`. Schema-validated structured output only. `sensitive: true` keeps the response out of shared caches.
- **CachePort** (`src/lib/ports/cache.ts`): `get`, `set` with `buildCacheKey({provider, model, promptVersion, input})` (sha256).

Why this discipline matters: swapping Gemini for Groq for Anthropic is a config change (one of `GEMINI_API_KEY`, `GROQ_API_KEY`, `ANTHROPIC_API_KEY` set), with no code touch. The local Ollama fallback is just a fourth implementation of `LlmPort` wired through the same `generateObject` entry point and the same cache keys. Mock implementations drive the entire test suite and the deterministic persona fixtures.

Wiring lives in exactly one place: `src/lib/composition.ts#getAgentDeps`. It reads `src/lib/config.ts` (the only file that touches `process.env`) and builds the `AgentDeps` singleton. Nothing else reads env vars.

## Determinism contract

Rekindle is a dementia-care tool. "The agent decided differently today" is not an acceptable answer. The determinism contract makes two of the three persona traces replay byte-identical across runs:

- **Temperature 0** fixed in `src/lib/config.ts`. All providers.
- **Pinned model IDs.** Not "gpt-5" but a specific `gemini-2.5-flash-exp` / `qwen3:8b` etc. Overridable only via `LLM_MODEL`.
- **Seven versioned prompt modules**, each exporting `ID` and `VERSION`. Bump on any change to system, render, or schema. The current versions are:

  | Module | ID | Version |
  |---|---|---|
  | `src/lib/prompts/parse-anchors.ts` | `parse-anchors` | 1.0.0 |
  | `src/lib/prompts/propose-candidates.ts` | `propose-candidates` | 1.0.0 |
  | `src/lib/prompts/match-entity.ts` | `match-entity` | 1.0.0 |
  | `src/lib/prompts/cultural-check.ts` | `cultural-check` | 1.0.0 |
  | `src/lib/prompts/critique-items.ts` | `critique-items` | 1.0.0 |
  | `src/lib/prompts/compose-session.ts` | `compose-session` | 1.0.0 |
  | `src/lib/prompts/replan-session.ts` | `replan-session` | 1.1.0 |

- **Input-keyed sha256 cache.** `buildCacheKey({provider, model, promptVersion, input})` keys every LLM and Qloo call. A re-run with the same input and same prompt version is a cache hit, not a new call.
- **Injected `now` and `newId`.** `AgentDeps` carries a `now()` and `newId()` so the agent never reaches for `Date.now()` or `nanoid` directly. In tests, both are replaced with deterministic stubs so events and ids are stable.
- **Replayable fixtures.** `tests/fixtures/trace-{maria,fatima,seamus}.ndjson` plus a `.meta.json` with the sha256 of the stream. Served live by `GET /api/session/replay?fixture=<slug>` at 500 ms per event cap, 15 s total cap.

## Qloo integration specifics: F1 through F4

The live-probe audit against `https://hackathon.api.qloo.com` produced four cultural-grounding fixes, all shipped and visible in the trace.

### F1: Resilient insights on empty

File: `src/lib/adapters/qloo/http.ts` lines 107-137.

When `/v2/insights` returns 0 items **and** the request had both `signal.location.query` and `filter.tags`, the adapter retries once without the location, then once without the tag filter, before giving up. Logged at `info` with the dropped param name only; the key is never printed.

Before: Maria's Neapolitan-music insights returned 0 results because `location.query=Naples` plus `filter.tags=urn:tag:genre:music:traditional` was over-constrained for Qloo's dataset.

After: the location drop recovers 1 result; the trace shows two `qloo_call` events with the retry visible, framed as *"no results with Naples + traditional tag; retried without location: 1 result."*

### F2: Cultural-mismatch gate (non-Western personas)

File: `src/lib/agent/phases/critique-compose.ts` lines 21-82.

A new `cultural-check` prompt (schema-validated structured output) runs only when `isNonWesternOrigin(anchors, person.sessionLanguage)` is true, over the EXPAND output. Mismatches surface as `rejected` events with `kind: "wrong_locale"` and a `cultural_mismatch:` reason prefix. The UI maps that prefix to the "Doesn't fit culture" badge in `src/components/session/rejection-display.ts`.

Before: Fatima's first live run surfaced Donald Trump as a 1960s Fès cross-domain affinity.

After: `cultural-check` drops Western extrapolations that Qloo's filters do not catch; Fatima's trace shows them as explicit cultural-mismatch rejections.

### F3: Cuisine-tag gate for food

Files: `src/lib/agent/phases/verify-expand.ts` lines 102-162 and `src/lib/agent/phases/parse-propose.ts` lines 120-131.

Qloo has no dish type, so food candidates are forced ungroundable. Before composing, a cuisine-tag side-lookup via `/v2/tags` resolves (for example) *"Italian cuisine"* for Maria; if it resolves, the food step stays as a caregiver-led idea; if not, the food step is dropped gracefully.

Before: a food candidate would fall through verify, hit `/search` for a dish name, and Qloo would surface airport-restaurant entities instead.

After: no food step unless the cuisine tag resolves. Fatima's plan correctly keeps a Moroccan mint-tea prompt; the airport-restaurant surfacing is gone.

### F4: Place normalization, no country fallback

File: `src/lib/agent/util.ts` lines 91-105.

`normalizePlaceName` narrows local aliases to the Qloo-known canonical form (`Fes` and `Fez` map to `Fès`). This is applied inside `primaryPlace` before every call. The adapter already drops the location signal on a 400 from an unknown place and does not widen to a country (because `Ireland` returns 0 affinities for Seamus, but `Cork` works). F4 keeps that behavior and makes the city hit.

### Request-to-result provenance

Every Qloo request emits exactly one `qloo_call` event (`src/lib/domain/types.ts` `QlooCallEvent`) immediately before the `verified`/`rejected` events it produced. The event carries the endpoint and the parameters as sent (never the key), the result count, duration, cache hit flag, and source (`live` or `mock`). The UI's expandable Qloo-call row shows all of this to the caregiver and the judge. Rough counts on the committed fixtures: 17 `qloo_call` events for Maria, 17 for Fatima, 20 for Seamus.

## Streaming contract (NDJSON `AgentEvent`)

Schema: `AgentEvent` in `src/lib/domain/types.ts` is a zod `discriminatedUnion("type", ...)` over eleven variants: `phase`, `note`, `anchors`, `candidate`, `verified`, `rejected`, `step`, `plan`, `qloo_call`, `error`, `done`. Every event is stamped with `seq` (starting at 0, incrementing by 1) and `t` (ms since stream start) by `createEventStamper`.

Why streaming over batch:

- **Perceived latency.** The caregiver sees the anchor list, candidates and the first verified entities within the first second. A batch response would show a loading spinner for 10 to 30 seconds, then a wall of text.
- **Progressive provenance.** Every Qloo request lands in the trace as it happens, with its params and duration. Judges see what the agent is doing live.
- **Error handling with partial recovery.** On a Qloo failure, the agent emits a `recoverable: true` error event and continues as LLM-only; the UI replaces the "Live Qloo" badge with a softer "Qloo degraded" state. On an LLM failure, the agent emits a `recoverable: false` error and `done`; the UI shows an inline Try again.
- **Byte-stable replay.** The `/api/session/replay` fixture route emits the same NDJSON byte-for-byte on every run. The determinism contract is directly observable.

The UI consumes it through `useAgentStream` (`src/hooks/useAgentStream.ts`) wrapping `readEventStream(response.body)` (`src/lib/domain/ndjson.ts`), reducing into pure view state in `src/components/session/view-state.ts` (unit-tested in `tests/e2e/view-state.spec.ts`).

### Event-order rules (enforced in contract tests)

- Exactly one `anchors` event, right after parse.
- Every `qloo_call` precedes the `verified`/`rejected` events it produced.
- Exactly one `plan` event per successful run. `step` events are previews for progressive rendering; the client replaces its steps with `plan.steps` when `plan` arrives.
- The last event is always `done`, even after a fatal error.

## Privacy and safety

- **`withPersonalDataGuard(port, forbiddenTerms)`** wraps every `TastePort` instance before the agent sees it. It stringifies each query payload, lowercases NFKC-normalizes it, and refuses the call if any forbidden term appears. `personalTermsFromDisplayName(displayName)` seeds the term list with the whole display name plus each word, and after PARSE the guard is extended with any family or friend names the LLM extracted from the notes. The guard is the enforcement point for HARD RULE 2 in `AGENTS.md`.
- **`sensitive: true` on notes-derived LLM output.** The PARSE phase passes `sensitive: true` to `LlmPort.generateObject`. The AI-SDK adapter and the Ollama adapter both honor it: the response is kept in process memory only and never written to Upstash.
- **PII redaction in the logger.** `createRequestLogger(traceId)` in `src/lib/logger.ts` installs a pino redaction list for `notes`, `displayName`, `anchors.sensitivities`, prompt bodies, and raw request bodies. The redactor is a safety net, not a license: the agent does not log those fields in the first place.
- **No regex or keyword lists for semantics.** All meaning (parsing notes, classifying candidates, cultural judgment, era inference, disambiguating search results) goes through `LlmPort.generateObject` with a zod schema. Deterministic code only reshapes already-structured data: mapping JSON, sorting, filtering by year numbers, exact-equality checks on normalized names, building query strings. See the ESLint boundary rule for `src/lib/agent/`.

## Local Ollama fallback

File: `src/lib/adapters/llm/ollama.ts` (257 lines).

Rekindle auto-wires to a local Ollama server at `http://127.0.0.1:11434` when it is reachable and no hosted LLM key is set. The adapter is hand-rolled on `fetch` against the native `POST /api/chat` endpoint. Reasons for not going through `@ai-sdk/openai` with `baseURL=http://127.0.0.1:11434/v1`:

- `@ai-sdk/openai` is not installed in this repo, and `AGENTS.md` forbids editing `package.json`.
- The native Ollama path exposes knobs the OpenAI-compat endpoint hides behind provider-specific extras:
  - `think: false` to disable qwen3's `<think>...</think>` reasoning stream, which otherwise breaks grammar-constrained JSON output.
  - `format: <JSON schema>` built from the prompt's zod schema (Ollama >= 0.5), enforcing structured output at the engine level, not just in the prompt.
  - `options.seed` for reproducibility.

### GPU fit at 8k context

`OLLAMA_NUM_CTX = 8192` (not configurable on purpose). Reasons:

- qwen3:8b at 32k context spilled to CPU on an RTX 2060 (6 GB VRAM); cold first call was 14.7 s, cached calls 3.5 s.
- At 8k context the model and its Q8 KV cache fit fully in the 6 GB GPU; cold first call drops to 5.5 s, cached calls to 1.8 s. Determinism preserved.
- Rekindle prompts are short; the loop never approaches 8k tokens in practice.

### Determinism

`OLLAMA_SEED = 42`, pinned, not configurable. Temperature 0. Same `buildCacheKey` as the hosted adapter: `provider="ollama"`, `model="qwen3:8b"`, `promptVersion=<v>`, normalized input. Byte-equal across two calls, verified by `scripts/ollama-probe.probe.ts`.

### Pre-warm

The caller can pre-warm the model with a dummy generation and `keep_alive: "10m"` so the first real agent call does not pay the cold load cost. The composition layer does this automatically at startup when the Ollama provider is selected.

### Why this matters for judging

Rekindle keeps working offline. A caregiver on a dodgy connection, or an organization that will not send intimate notes to a third-party API, can run the full agent locally with no quality loss on the three personas. For the hackathon demo the hosted deployment uses Groq or Gemini (so it fits inside Vercel Hobby's 60 s request limit), but the fact that the fallback exists at all is the trust story.

## Testing

- 209 unit tests across 26 files (`npm test`). Golden snapshots for each persona plan, no anachronism or sensitivity leaks, plan validates against the frozen schema, output is byte-stable for the determinism check.
- Playwright E2E tests across chromium and mobile viewports, always in mock mode on port 3100. The reducer in `src/components/session/view-state.ts` is unit-tested on recorded events.
- Contract tests in `tests/contract/` enforce the frozen domain types and the NDJSON event-order rules.
- `npm run check` runs typecheck, lint, unit tests, and the production build in one pass. Must be green before every commit.
