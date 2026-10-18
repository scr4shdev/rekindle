# AGENTS.md: rules for every agent working on Rekindle

Rekindle is a reminiscence **activity** planner for caregivers of people living with dementia (non-medical framing:
never "therapy", "treatment" or "diagnosis"). The caregiver enters a few facts; a hybrid LLM + Qloo agent rebuilds the
person's era-and-place cultural world and composes a timed, guided session with conversation prompts. No login, nothing stored.

Read first: `README.md` (architecture), `docs/api.md` (HTTP + event contract), `docs/qloo-api.md` (real Qloo API),
`TODO.md` (task board), `src/lib/domain/types.ts` (domain schemas).

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Environment

- Node via nvm. Start **every** shell command with `export PATH="$HOME/.nvm/versions/node/v24.22.0/bin:$PATH"`.
- Next.js 16.4 (App Router, Turbopack, `cacheComponents: true`), React 19.3, Tailwind v4, shadcn (base-nova, Base UI),
  zod 4, Vercel AI SDK 7, pino 10, vitest 5, Playwright.
- `.env.local` holds secrets. **Never print, commit, copy or modify it.** Keys may be empty: the app must work fully in mock mode.
- Local only: do not deploy, push, or create remote repos.
- **Do not edit `package.json` / `package-lock.json`.** All dependencies are installed. Need one? Add a `BLOCKED:` note in TODO.md.

## Ownership (who may edit what)

| Owner | Paths |
|---|---|
| **Integrator / Architect** | `src/lib/domain/**`, `src/lib/ports/**`, `src/lib/config.ts`, `src/lib/logger.ts`, `src/lib/personas.ts`, `package.json`, `package-lock.json`, `.github/**`, `docs/**`, `AGENTS.md`, `CLAUDE.md`, `README.md`, `TODO.md` structure, `eslint.config.mjs`, `vitest.config.mts`, `playwright.config.ts`, `tests/contract/**`, `.env.example` |
| **W-CORE** (backend + agent) | `src/lib/adapters/**`, `src/lib/agent/**`, `src/lib/prompts/**`, `src/lib/composition.ts`, `src/app/api/**`, `tests/unit/**`, `scripts/**` |
| **W-UI** (frontend) | `src/app/**` except `src/app/api/**`, `src/components/**` (shadcn primitives in `src/components/ui` may be restyled), `src/hooks/**`, `src/i18n/**`, `src/app/globals.css`, `public/**`, `next.config.ts` (images/remotePatterns only), `tests/e2e/**` |

Each worker updates only its own task rows in `TODO.md`.

### Frozen contracts

`src/lib/domain/**`, `src/lib/ports/**`, `src/lib/config.ts`, `src/lib/logger.ts` are **frozen** after Phase 0.
Builders must not edit them. If you need a change, add a line under "Contract change requests" in `TODO.md`:
`BLOCKED: contract change needed: <file> <what and why>`, mark your task `blocked`, and continue with another task.
You may define **internal** types in your own area (e.g. LLM-facing output schemas in `src/lib/prompts/`).

## HARD RULES (Qloo safe use, hackathon email): never break these

1. **The Qloo key stays server-side.** It is read only by `src/lib/config.ts` and used only by the Qloo adapter in route
   handlers. Never in client code, `NEXT_PUBLIC_*` vars, the repo, logs, error messages, screenshots or recordings.
2. **Never send personal data to Qloo**: no person names, caregiver names, emails, device ids, account ids, free-text notes,
   or location histories. Only cultural anchors: public entity names and Qloo ids, tag ids, public place names, years,
   and the aggregate age bucket. Adapters MUST parse every query with the strict schemas in `src/lib/ports/taste.ts`,
   and the agent MUST wrap the taste port with `withPersonalDataGuard(port, personalTermsFromDisplayName(person.displayName))`
   for every request.
3. **Qloo results are aggregate.** They describe what groups of people who like X also tend to like, not this person's
   preferences. Copy and UI must say "people who enjoy X also tend to enjoy Y", never "Maria will like Y". Keep Qloo results
   visibly separate from LLM interpretation (provenance badges, `qloo_call` trace).
4. **Base URL** is `https://hackathon.api.qloo.com` (config default). Hackathon keys work only there.
5. **Recorded live Qloo responses are never committed** (`.qloo-recordings/` is git-ignored). Committed fixtures are hand-authored.
6. **Bounded usage**: cache Qloo calls, retry only 429/5xx with bounded attempts, smallest useful `take`, no bulk scraping.
7. Production calls the documented HTTP API directly (serverless-safe). The `qloo` CLI (`qloo exec`, `qloo mcp`) is used only
   in developer scripts (parity checks), never at app runtime. See docs/qloo-api.md section 8.

## Architecture rules

- **Ports and adapters.** Qloo, LLM and cache sit behind interfaces in `src/lib/ports/` (`TastePort`, `LlmPort`,
  `CachePort`). Adapters live in `src/lib/adapters/{qloo,llm,cache}/`. The agent loop in `src/lib/agent/` depends
  **only** on ports and domain types (ESLint enforces this). `src/lib/composition.ts` is the single place that reads
  config and wires adapters into `AgentDeps`.
- **No regex or keyword lists for semantics.** All meaning (parsing notes, classifying, safety judgment, era inference,
  disambiguating search results) goes through the LLM via schema-validated structured output (`LlmPort.generateObject`).
  Deterministic code only reshapes already-structured data (mapping JSON, sorting, filtering by year numbers,
  exact-equality checks on normalized names, building query strings).
- **Determinism.** Temperature 0 (fixed in config). Pinned model ids from config. Every prompt module exports `ID`
  and `VERSION` (bump on any change to system/render/schema). Zod output schemas. Input-keyed cache: `buildCacheKey`
  (sha256 of provider + model + promptVersion + normalized input) for LLM and Qloo calls. Inject `now` and `newId`
  (from `AgentDeps`) instead of calling `Date.now()`/`nanoid` inside the agent.
- **Config.** Only `src/lib/config.ts` reads `process.env`. No hardcoded model ids, TTLs, URLs or limits elsewhere.
  Missing keys mean mock mode, not a crash. Invalid values fail fast.
- **Logging.** pino via `createRequestLogger(traceId)` from `src/lib/logger.ts`, passed down in `CallContext`. Log ids,
  counts, timings, phases, cache hits. Never log notes, anchors, person names, prompts or request bodies (redaction
  is a safety net, not a licence). **No `console.*`** (ESLint error).
- **Security and privacy.** Never log or cache plaintext notes. Cache keys are hashes. Results derived from notes
  (PARSE) use `sensitive: true` so they stay in process memory only. Zod-validate every API route input. Secrets only
  from config. User-facing error messages never include stack traces, keys, or submitted text.
- **Serverless (Vercel Hobby).** Route handlers only, Node runtime, `export const maxDuration = 60`, stream NDJSON,
  respect `config.agent.deadlineMs` and the request `AbortSignal`, no long-running servers or background jobs.
  With `cacheComponents` enabled, `export const dynamic` / `revalidate` are **removed**: do not use them.
- **AI SDK 7.** `generateObject` is deprecated: use `generateText({ ..., output: Output.object({ schema }) })`.
  Pass the API key explicitly from config to `createGoogleGenerativeAI` / `createGroq` / `createAnthropic`.
- **LLM output schemas** should be provider-friendly (objects, arrays, enums, strings, numbers; avoid `z.url()`,
  unions and deep optionals). Map them into domain types in code and validate with the domain schema.
- **UI** imports domain types and `src/lib/domain/ndjson.ts`, `src/lib/personas.ts`, `src/lib/domain/sample-events.ts`
  only. Never import adapters, agent, config or logger from client code (ESLint enforces this for `src/components`).

## Working method (PDCA-lite)

For each task in `TODO.md`:

1. **Plan:** set the task `in-progress`; write its subtasks and acceptance criteria if missing.
2. **Do:** implement **one** subtask (about 300 changed lines or fewer).
3. **Check:** `npm run check` (typecheck + lint + test + build) must be green; also run the tests you added.
   UI work: also `npm run e2e` for affected flows.
4. **Act:** commit (one subtask per commit), update the status in `TODO.md` in the same commit, move to the next.

Commits: conventional messages (`feat(agent): ...`, `fix(ui): ...`, `test(core): ...`, `docs: ...`), small, on `main`.
**No attribution trailers** (no `Co-Authored-By`, no "Generated with"). Never commit with a red `npm run check`.
Never commit `.env*` files other than `.env.example`.

Statuses: `todo` · `in-progress` · `blocked` · `review` · `done`.

## Commands

```bash
npm run dev          # http://localhost:3000 (mock mode without keys)
npm run check        # typecheck + lint + test + build: must pass before every commit
npm run test         # vitest (tests/unit, tests/contract)
npm run e2e          # playwright (tests/e2e), always mock mode, port 3100
REKINDLE_FORCE_MOCK=true npm run dev   # force mocks even with keys
```
