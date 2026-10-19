# TODO: Rekindle task board

Statuses: `todo` · `in-progress` · `blocked` · `review` · `done`. Format: `- [status] ID Title`, then `AC:` (acceptance criteria).
Each subtask is about 300 changed lines or fewer and is **one commit** (with this file's status update in the same commit).
Workers edit only their own rows. Method: see "Working method" in `AGENTS.md`.
Deadline: **2026-10-30**. Judging: Technological Implementation, Design, Potential Impact, Quality of Idea (judges click the live app).

## Contract change requests

Add `BLOCKED: contract change needed: <file> <what and why> (<worker>, <date>)` here. The integrator answers inline.

- Request (non-blocking): tests/contract/domain.test.ts: export the `QUIZ` pattern from a shared helper (e.g. `tests/contract/quiz.ts`) so `tests/unit/mock-prompts-quiz.test.ts` can import it; it currently reads the constant from the contract file's source to avoid a copy. (W-CORE, 2026-10-18)
- BLOCKED: contract change needed: src/lib/config.ts (added `ollamaBaseUrl` and `ollamaModel` to `AppConfig.llm`, extended `LLM_PROVIDERS` with `ollama` and `LLM_PROVIDER=ollama` auto-selection) — applied, pending integrator sign-off. (W-CORE, 2026-10-19)
- Disclosure (not a bug): with Ollama in the mix, the keyed auto-selection order became `anthropic > gemini > groq` (previously `gemini > groq > anthropic`); a hosted env with multiple keys set may pick a different provider than before. Set `LLM_PROVIDER` explicitly to lock the choice. (W-CORE, 2026-10-19)
- Request (non-blocking): src/lib/ports/taste.ts: expose a `fallbackOnEmpty?: boolean` option on `TastePort.insights` (or on `TasteInsightsQuery`) so the empty-result retry can be opt-in rather than being triggered automatically whenever a request combines `signal.location.query` and `filter.tags`. Current implementation (F1) lives in the adapter and is a strict improvement; no behavior opt-out needed for the hackathon demo. contract: src/lib/ports/taste.ts (W-CORE, 2026-10-19)
- Request (non-blocking): src/lib/domain/types.ts: `RejectionKind` has no `cultural_mismatch` value. F2's cultural-check rejections currently use `wrong_locale` with a `cultural_mismatch:` reason prefix; a dedicated kind would read better in the trace. contract: src/lib/domain/types.ts (W-CORE, 2026-10-19)

### feat/qloo-grounding (F1-F4) implementer notes

- F1 (resilient insights on empty) — `src/lib/adapters/qloo/http.ts:107-137`: when `/v2/insights` returns 0 items AND the request had both `signal.location.query` and `filter.tags`, retry once without the location, then once without the tag filter. Logged at `info` with the dropped param name only; no key, no notes.
- F2 (cultural-mismatch gate) — `src/lib/agent/phases/critique-compose.ts:21-82`: new `cultural-check` prompt (schema-validated structured output). Runs only when `isNonWesternOrigin(anchors, person.sessionLanguage)` is true. Mismatches surface as `rejected` events with `kind: wrong_locale` and a `cultural_mismatch:` reason prefix. UI maps the sentinel to the "Doesn't fit culture" badge via `src/components/session/rejection-display.ts`.
- F3 (cuisine-tag gate for food) — `src/lib/agent/phases/verify-expand.ts:102-162` + `src/lib/agent/phases/parse-propose.ts:120-131`: food candidates are forced ungroundable, and a cuisine-tag `/v2/tags` side-lookup gates whether they stay as caregiver-led ideas or get dropped. Mock catalog gains cuisine tags for the three personas.
- F4 (Fès alias, no country fallback) — `src/lib/agent/util.ts:91-105`: narrow `normalizePlaceName` (`Fes`/`Fez` → `Fès`), applied inside `primaryPlace`. The adapter already drops the location signal on 400 and does not widen to a country; F4 keeps that behavior.

## Phase 0: Architect (done)

- [done] A0.1 Git init, dependencies, shadcn primitives
- [done] A0.2 Qloo API research: `docs/qloo-api.md`
- [done] A0.3 Frozen contracts: domain types, NDJSON, ports, config, logger, personas, sample events
- [done] A0.4 Tooling: vitest, playwright, ESLint boundaries, `npm run check`, CI with gitleaks
- [done] A0.5 AGENTS.md, TODO.md, README.md, docs/api.md
- [done] A0.6 Hackathon email: base URL, harness study (docs/qloo-api.md section 8), PII-free TastePort, docs/submission-requirements.md

---

## W-CORE: adapters, agent loop, API

### Epic C1: Cache adapters (`src/lib/adapters/cache/`)
- [done] C1.1 `MemoryCache` (TTL plus a bounded LRU, max entries as a documented module constant)
  AC: implements `CachePort`; expired entries are misses; unit tests with fake timers.
- [done] C1.2 `UpstashCache` and `LayeredCache` (memory in front of Upstash)
  AC: `sensitive: true` values are never sent to Upstash; Upstash errors degrade to a miss plus a warn log (never throw);
  JSON round-trip; tests with a fake Redis client.

### Epic C2: LLM adapter (`src/lib/adapters/llm/`)
- [done] C2.1 `AiSdkLlm`: provider factory (gemini/groq/anthropic) from config, `generateText` + `Output.object`, temperature 0
  AC: cache-through via `buildCacheKey({provider, model, promptVersion: version, input})` (with `sensitive` passed on); timeout via
  AbortSignal; retries from config; errors mapped to `PortError("llm", ...)`; returns latency/usage; logs promptId, version,
  latency and cache hit only; tests use the AI SDK mock model (`ai/test`).
- [done] C2.2 `MockLlm`: deterministic fixture responses per `promptId` for the 3 personas
  AC: persona fixtures in `src/lib/adapters/llm/fixtures/`, consistent with `sample-events.ts` (Maria) and authentic for Seamus/Fatima;
  for custom input, a generic deterministic response built from the structured fields (birthYear, birthPlace, languages), with no
  regex over notes; output always validates against `request.schema`.

### Epic C3: Qloo adapter (`src/lib/adapters/qloo/`)
- [done] C3.1 `QlooHttp`: query builder plus fetch
  AC: every query parsed with the strict port schemas first (unknown keys rejected); GET with `X-Api-Key`;
  returns `TasteResponse` with a `QlooCallRecord` (params as sent, never the key); comma-joined arrays; era filters only per `ERA_FILTER_SUPPORT`; `bias.trends` default `off`;
  `take` at most 50; retry on 429/5xx honouring Retry-After (max from config); timeout; on a 400 from an unknown `signal.location.query`,
  retry once without it; cached with `buildCacheKey({provider:"qloo", model:<endpoint>, promptVersion:"qloo-v2", input:query})`.
- [done] C3.2 Response mapping to `TasteEntity`
  AC: defensive parsing per docs/qloo-api.md (`results[]` vs `results.entities[]`, `entity_id ?? id`, `subtype ?? types[]`,
  `properties.image.url`, `query.affinity`, `release_year`/`publication_year`/`date_of_birth`); unknown types dropped;
  zod-validated raw shapes with `.passthrough()`; tests against recorded JSON fixtures in `tests/unit/fixtures/qloo/`.
- [done] C3.3 `MockQloo`: fixture catalog for the 3 personas
  AC: search = exact match on normalized names within types; insights = seed-keyed fixture lists that respect type and era filters;
  includes the Maria entities from `sample-events.ts`; deterministic order.
- [blocked] C3.4 Live probe and parity script `scripts/qloo-probe.ts` (waiting for the Qloo key)
  AC: verifies every UNCERTAIN item in docs/qloo-api.md section 7 (search item shape, videogame, location effect, tag ids);
  parity check: runs persona anchors through `qloo exec describe|recommend|find_tags` (official harness, needs
  `QLOO_TRUSTED_BASE_URL`) and through `QlooHttp`, and reports id overlap; writes raw responses only to the git-ignored
  `.qloo-recordings/` (never commit live data); hand-authors any committed fixtures; integrator updates the docs.
  W-CORE note: script written and dry-run (no key: exits cleanly) at `scripts/qloo-probe.probe.ts`, run with
  `QLOO_API_KEY=... npx vitest run --config scripts/vitest.probe.config.mts` (vitest runner so `@/` aliases resolve without new deps).
  BLOCKED: waiting for the Qloo key to run it live.

### Epic C4: Versioned prompts (`src/lib/prompts/`)
- [done] C4.1 `parse-anchors` (notes to `Anchors`; formative window from config ages; sensitivities; languages)
- [done] C4.2 `propose-candidates` (anchors to candidates per domain, era and locale correct, with a `qlooType` hint per `TASTE_DOMAIN_QLOO_TYPES`)
- [done] C4.3 `match-entity` (pick the matching Qloo search result or none, for when an exact normalized-name match fails)
- [done] C4.4 `critique-items` (anachronism, wrong_locale, emotional_risk, duplicate, with reasons in the caregiver language)
- [done] C4.5 `compose-session` (timed steps, open-ended non-quiz prompts in the session language plus translations, tips, disclaimer)
- [done] C4.6 `replan-session` (reaction-aware rewrite of upcoming steps)
  AC (all): module exports `ID`, `VERSION`, `system`, `render`, `schema` as a `PromptDefinition`; dementia-friendly guidance
  (no quizzing, no "do you remember?" pressure, follow their lead); render snapshot tests.

### Epic C5: Agent loop (`src/lib/agent/`, ports only)
- [done] C5.1 `runSession(deps, request, ctx)` skeleton as an `AsyncGenerator<AgentEvent>`
  AC: wraps `deps.taste` with `withPersonalDataGuard` (HARD RULE 2); emits a `qloo_call` event per Qloo request; stamps events with `createEventStamper`; phase started/completed with durations and counts; deadline and abort handling;
  stats in `done`; `done` is always last; PortError mapped to an `error` event.
- [done] C5.2 PARSE and PROPOSE phases. AC: emits `anchors`, `note`s and `candidate`s; candidate counts capped by config.
- [done] C5.3 VERIFY phase. AC: bounded concurrency; exact normalized-name match, else the `match-entity` LLM call; `verified` or `rejected(not_found)` per candidate; non-groundable domains pass through as llm-only material.
- [done] C5.4 EXPAND phase. AC: insights per target type from verified seeds; era filters by `ERA_FILTER_SUPPORT`; `signal.location.query` from anchors;
  `55_and_older`; excludes the seeds; dedupe; `provenance: "qloo-affinity"` with `seedQlooIds`.
- [done] C5.5 CRITIQUE and COMPOSE phases. AC: rejected items never appear in the plan; step `provenance` is decided in code
  (has a verified entity: `qloo-grounded`); durations sum to `totalMinutes`; `meta` filled with prompt versions.
- [done] C5.6 LLM-only mode. AC: verify/expand emitted as `skipped`; all steps `llm-only`; `meta.qlooMode = "unused"`.
- [done] C5.7 Replan loop `runReplan`. AC: semantics in docs/api.md; past steps unchanged; `meta.revision + 1`.
- [done] C5.8 Degradation. AC: Qloo failure gives a recoverable `error` and the session continues as llm-only steps; LLM failure gives a fatal `error` then `done`.

### Epic C6: Composition and API routes
- [done] C6.1 `src/lib/composition.ts` (`getAgentDeps()` singleton from config) and `GET /api/health`
- [done] C6.2 `POST /api/session` (zod validation with a 400 JSON before streaming, 64 KB limit, `x-trace-id`, NDJSON stream, `maxDuration = 60`)
- [done] C6.3 `POST /api/session/replan`
- [done] C6.4 Route tests (call the handlers with `Request` objects in mock mode; assert the event order rules from docs/api.md)

### Epic C7: Quality
- [done] C7.1 Golden tests: mock run for each persona; no anachronism or sensitivity leaks; plan validates; stable output (determinism)
- [done] C7.2 Coverage at least 80% for `src/lib/agent` and `src/lib/adapters`

---

## W-UI: design, flows, E2E

Build against `src/lib/domain/sample-events.ts` until the W-CORE API works (C6.2). Keep one `EventSource` interface
with two implementations: `fetch` + `readEventStream`, and a sample replay (`?source=sample`).

### Epic U1: Design system
- [done] U1.1 Tokens in `globals.css`: warm, calm, era-evocative palette (paper, ink, terracotta, sage), light and dark, WCAG AA contrast
  AC: paper/ink/terracotta/sage/ochre/rose tokens for light and dark (`next-themes`, class strategy); every text pair >= 4.5:1
  (checked with an oklch contrast script); paper grain background; `prefers-reduced-motion` disables animation.
- [done] U1.2 Typography: large readable type (base at least 18px), a display serif plus a highly legible sans (e.g. Atkinson Hyperlegible) via `next/font`
  AC: Fraunces (display) + Atkinson Hyperlegible Next (body) + Atkinson Hyperlegible Mono (Qloo params); root font-size 18px.
- [done] U1.3 Restyle the shadcn primitives through the theme so it does not look like default shadcn; app shell (header, footer with
  the non-medical disclaimer and the "nothing is stored" promise), `TooltipProvider` and `Toaster` in the layout
  AC: buttons/inputs at least 48px tall, pill buttons, paper cards with a soft shadow; header with theme toggle; footer with disclaimer
  and privacy promise; strings from `src/i18n/en.ts`.
  AC (epic): axe has no serious violations; focus rings visible; `prefers-reduced-motion` respected.

### Epic U2: Landing
- [done] U2.1 Hero and value proposition (non-medical wording), 3 one-tap persona cards from `PERSONAS`
  AC: first screen shows the promise ("nothing is stored"), three large persona cards linking to `/session?persona=<slug>`, form below.
- [done] U2.2 Custom form (notes, birth year, birthplace, session/caregiver language, minutes) validated with the `PersonInput` schema; grounded vs LLM-only toggle
  AC: zod `PersonInput.safeParse` with inline accessible errors (`aria-invalid`, `aria-describedby`); input is kept only in client memory
  (module store, never in the URL or storage) and handed to `/session?persona=custom`.

### Epic U3: Session page (streaming)
- [done] U3.1 `useAgentStream` hook plus an events-to-view-state reducer (unit-safe, pure); sample replay source
  AC: `AgentEventSource` interface (`src/components/session/source.ts`) with `apiSource` (fetch + `readEventStream`, JSON 4xx mapped
  to a safe message) and `sampleSource` (replays recorded events with their timing, `?speed=`); `?source=sample|api`, default `auto`
  (API, falling back to the recording for Maria when the route is missing); reducer is pure and tested in `tests/e2e/view-state.spec.ts`.
- [done] U3.2 Live reasoning trace: phase timeline (started/completed/skipped), notes, candidate, verified and rejected chips with reasons,
  expandable `qloo_call` rows (endpoint plus params: the request-to-result evidence); copy frames Qloo results as aggregate
  ("people who enjoy X also tend to enjoy Y")
- [done] U3.3 Plan timeline: step cards with an image or era-styled fallback, kind icon, duration, provenance and affinity badges, media hint, prompt and translation
- [done] U3.4 Error and degraded states (recoverable vs fatal), cancel and retry

### Epic U4: Comparison mode
- [done] U4.1 Side-by-side grounded vs LLM-only (two parallel streams) with a summary: verified count, anachronisms caught, images, affinity

### Epic U5: Caregiver session mode
- [done] U5.1 One prompt at a time, huge text, step timer, next/prev, translation toggle, keyboard and touch friendly
- [done] U5.2 Lit up / no reaction / upset buttons call `POST /api/session/replan` (sample replan when on the sample source); animated plan update

### Epic U6: Print, i18n, responsive
- [done] U6.1 Print stylesheet (session sheet the caregiver can print)
- [done] U6.2 UI strings in `src/i18n/` (en first, structure ready for it/fr), `lang` attributes on prompts
- [done] U6.3 Responsive pass (phone first: caregivers use phones)

### Epic U7: E2E (`tests/e2e/`)
- [done] U7.1 Persona to session (sample source and mock API), trace and plan render
- [done] U7.2 Custom form validation; comparison mode; session mode plus replan
- [done] U7.3 axe accessibility checks (`@axe-core/playwright`) on landing, session and session mode

---

## Integrator (Architect)

- [todo] I1 Review W-CORE and W-UI commits against contracts and AGENTS.md rules
- [blocked] I2 When the Qloo key arrives: run C3.4 with W-CORE, update `docs/qloo-api.md`, resolve UNCERTAIN items
- [todo] I3 Wire the UI to the real API (after C6.2 and U3.1); end-to-end in mock mode, then live mode
- [todo] I4 Decide the share-link approach (stateless encoded plan vs no sharing) and the deploy (user decision)
- [todo] I5 Final README polish, demo script for judges, screenshots; tick every item in docs/submission-requirements.md
- [todo] I6 Ask the organizers: is direct HTTP from a serverless backend OK (docs/submission-requirements.md, open questions)
