# Rekindle

**Plan a warm, era-true reminiscence activity for someone you care for.**

Rekindle helps family members and caregivers of people living with dementia run a 15 to 30 minute reminiscence
**activity** (not therapy, not medical advice). You type a few facts ("born 1942, grew up in Naples, loved Sinatra and
football"). An agent rebuilds the cultural world of that person's youth (the music, films, faces, sport, food and fashion
of their place and era) and turns it into a gentle, timed session: what to play, what to show, and what to say, in the
person's own language. During the session you tap *lit up*, *no reaction* or *upset*, and the agent adapts what comes next.

No login. Nothing you type is stored.

> Status: Phase 0 (architecture and contracts). Built for the Qloo Agentic Hackathon (deadline 2026-10-30).

## Why

Reminiscence activities built on music and images from a person's formative years (roughly ages 10 to 30) are among the
most widely used non-drug activities in dementia care. They are hard to prepare well: the caregiver has to know which songs,
films and public figures belonged to a 1950s Naples youth or a 1960s Cork dance hall, and avoid things that upset them.
Generic LLM suggestions are often anachronistic, from the wrong country, or invented outright.

## How it works

```
caregiver notes ──► PARSE ──► PROPOSE ──► VERIFY ──► EXPAND ──► CRITIQUE ──► COMPOSE ──► timed session
                    (LLM)     (LLM)       (Qloo)     (Qloo)     (LLM)        (LLM)          │
                    anchors:  era/locale  /search:   /v2/insights   rejects      steps,        ▼
                    birth yr, candidates  does it    cross-domain   anachronisms prompts in    caregiver taps
                    places,   per domain  exist? id, affinity from  and risky    the person's  lit up / neutral / upset
                    loves,                image,     verified seeds, items, with language        │
                    sensitiv.             year       era-filtered    reasons                     ▼
                                                                                          REPLAN (LLM + Qloo)
```

Every phase streams events (NDJSON) to the UI, so the caregiver sees the reasoning live: what was proposed, what Qloo confirmed,
which Qloo requests were made, what was rejected and why. A **comparison mode** runs the same notes LLM-only (no Qloo) side by side,
to show what grounding adds: real entities, images, era checks, and discoveries the model alone would not make.

### What Qloo does here, and what it does not

Qloo's taste graph tells us **what groups of people who enjoy one thing also tend to enjoy**, across domains (music, film, TV,
books, public figures, places, brands). Rekindle uses it in three ways:

- **Verify** that an LLM-proposed entity exists, and get its id, image and release year (`GET /search`).
- **Expand** from verified seeds to other domains, filtered to the person's formative years where Qloo supports it
  (`GET /v2/insights` with `filter.release_year.*` for film and TV, `filter.date_of_birth.*` for people, decade tags for music).
- **Decade and genre tags** where there is no year filter (`GET /v2/tags`).

Qloo results are **aggregate affinities, not facts about this person**. When Rekindle shows "people who enjoy Sinatra and
Carosone also tend to enjoy Peppino di Capri", that is a suggestion for the caregiver to try, not a prediction. The person's own
reactions, recorded with the three buttons, always win. **No personal data is ever sent to Qloo**: only cultural anchors such as
public entity names, ids, place names, years and an age bucket (enforced in code, see `src/lib/ports/taste.ts`).

### Architecture

```
src/
  app/                    Next.js App Router (UI, W-UI)
    api/session/          POST: streams AgentEvents as NDJSON          (W-CORE)
    api/session/replan/   POST: adapts the plan to a reaction           (W-CORE)
    api/health/           GET: mock/live status                         (W-CORE)
  components/             UI components; components/ui = shadcn primitives (W-UI)
  lib/
    domain/               FROZEN zod schemas + types, NDJSON framing, sample event streams
    ports/                FROZEN interfaces: TastePort, LlmPort, CachePort (+ cache key, PII guard)
    config.ts             FROZEN zod-validated env config (missing keys → mock mode)
    logger.ts             FROZEN pino logger with trace ids and redaction
    personas.ts           3 demo personas
    adapters/{qloo,llm,cache}/   HTTP Qloo, Vercel AI SDK (Gemini/Groq/Anthropic), memory/Upstash, + mocks (W-CORE)
    prompts/              versioned prompt modules (W-CORE)
    agent/                the 6-phase loop + replan; depends only on ports (W-CORE)
    composition.ts        wires adapters from config (W-CORE)
```

Principles: ports and adapters; every semantic judgment goes through schema-validated LLM output (no regex or keyword
lists); deterministic by design (temperature 0, pinned model ids, versioned prompts, input-keyed sha256 cache); privacy
first (no storage, redacted logs, PII-free Qloo queries); serverless on Vercel Hobby. Details: [AGENTS.md](AGENTS.md).

## Run locally (no keys needed)

Requirements: Node.js 24.

```bash
npm ci
npm run dev            # http://localhost:3000, runs fully in mock mode without keys
npm run check          # typecheck + lint + unit/contract tests + production build
npx playwright install chromium && npm run e2e   # browser tests (always mock mode)
```

### Live mode

Copy `.env.example` to `.env.local` and fill what you have. Each provider switches to live mode independently when its key is set.

| Variable | Purpose | Default |
|---|---|---|
| `QLOO_API_KEY` | Qloo Insights API key (server-side only) | empty: mock Qloo |
| `QLOO_BASE_URL` | Qloo host | `https://hackathon.api.qloo.com` |
| `LLM_PROVIDER` | `gemini`, `groq`, `anthropic` or `mock` | first provider with a key, else mock |
| `LLM_MODEL` | Override the pinned model | per provider (see `src/lib/config.ts`) |
| `GEMINI_API_KEY` / `GROQ_API_KEY` / `ANTHROPIC_API_KEY` | LLM provider keys | empty |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Shared cache across serverless instances | empty: in-memory cache |
| `REKINDLE_FORCE_MOCK` | Force mocks even when keys are set | `false` |
| `LOG_LEVEL` | pino level | `info` |

All variables and limits: [.env.example](.env.example). API contract: [docs/api.md](docs/api.md). Qloo API notes:
[docs/qloo-api.md](docs/qloo-api.md). Submission checklist: [docs/submission-requirements.md](docs/submission-requirements.md).

## Limitations

- Not a medical device and not therapy. It suggests activities; the caregiver decides. Stop if the person is uncomfortable.
- Qloo affinities are aggregate and say nothing certain about one person. Coverage of some regions and eras may be thin.
- Qloo has no dish type and no year filter for music artists, so food steps are LLM-only and music era checks use tags plus the LLM critique.
- LLM mistakes are reduced (verification, critique, provenance badges) but not eliminated.

## License

TBD.
