# Rekindle HTTP API (contract)

Status: FROZEN after Phase 0. Schemas live in `src/lib/domain/types.ts`; this document explains them.
Changes go through the integrator (`BLOCKED: contract change needed` in `TODO.md`).

All routes are Next.js App Router route handlers (`src/app/api/**/route.ts`), Node.js runtime,
stateless, and safe for Vercel Hobby serverless (`export const maxDuration = 60`). Nothing the caregiver
types is stored: there is no database, and every request carries the whole state it needs.

## Conventions

- Request bodies are JSON, validated with zod (`SessionRequest`, `ReplanRequest`). Body limit: 64 KB.
- Streaming responses are NDJSON: `Content-Type: application/x-ndjson; charset=utf-8`, one `AgentEvent`
  JSON object per line, flushed as produced. Use `toNdjsonStream()` on the server and
  `readEventStream(response.body)` on the client (`src/lib/domain/ndjson.ts`).
- Every response has an `x-trace-id` header. The same id appears in the final `done` event and in server logs.
- Validation errors happen **before** streaming starts and return a normal JSON response:

```http
HTTP/1.1 400 Bad Request
Content-Type: application/json

{ "error": { "code": "invalid_input", "message": "Request body is invalid.", "issues": [{ "path": "person.notes", "message": "Too small: expected string to have >=10 characters" }] } }
```

  `issues[].message` never echoes submitted values. Other pre-stream errors: `413` (body too large), `415` (not JSON),
  `405` (wrong method), `429` (rate limited, optional).
- Once streaming has started the status is always `200`; failures arrive as `error` events.

## Event stream rules (both streaming routes)

| Rule | Detail |
|---|---|
| Stamping | `seq` starts at 0 and increments by 1; `t` is ms since the stream started (`createEventStamper`). |
| Phases | Each phase emits `phase{status:"started"}` then `phase{status:"completed"}` (with `durationMs`, `counts`), or a single `phase{status:"skipped"}`. Phase order: `parse, propose, verify, expand, critique, compose` (session) or `replan` (replan). |
| Provenance | Every Qloo request emits one `qloo_call` event before the `verified`/`rejected` events it produced. Its params contain only cultural anchors, never personal data or the key. |
| Narration | `phase.message` and `note.text` are short, human-readable, in the caregiver language, and contain no secrets. They are the "reasoning trace". |
| Anchors | Session stream: exactly one `anchors` event, right after parse. The client keeps it for replans. |
| Plan | Exactly one `plan` event per successful stream. It is authoritative: `step` events are previews for progressive rendering, and the client replaces its steps with `plan.steps` when `plan` arrives. |
| Errors | `error{recoverable:true}` means the agent degraded and continues (e.g. Qloo down, so it falls back to llm-only steps). `error{recoverable:false}` means no plan will come. |
| Termination | The last event is always `done`, even after a fatal error. |

Event types (`AgentEvent`, discriminated on `type`):

| type | payload | emitted in |
|---|---|---|
| `phase` | `phase, status, message, durationMs?, counts?` | all phases |
| `note` | `phase, text` | any phase |
| `anchors` | `anchors: Anchors` | parse |
| `candidate` | `candidate: Candidate` | propose |
| `verified` | `entity: VerifiedEntity` (`provenance` is `llm-proposed-qloo-verified` or `qloo-affinity`) | verify, expand, replan |
| `rejected` | `item: RejectedItem` (`kind`, `reason`, `phase`) | verify, critique, replan |
| `step` | `step: SessionStep` | compose, replan |
| `plan` | `plan: SessionPlan` | compose, replan |
| `qloo_call` | `phase, call: QlooCallRecord` (endpoint, params as sent, resultCount, durationMs, cached, source) for every Qloo request: request-to-result provenance | verify, expand, replan |
| `error` | `code, message, recoverable, phase?` | any |
| `done` | `traceId, durationMs, stats` | last |

Recorded examples of all of these: `src/lib/domain/sample-events.ts`.

---

## `POST /api/session`

Builds a session plan. Body: `SessionRequest`.

```jsonc
{
  "mode": "grounded",            // "grounded" (default) | "llm-only"
  "person": {
    "displayName": "Nonna Maria", // optional
    "notes": "My grandmother Maria was born in 1942 in Naples…", // 10-2000 chars, required
    "birthYear": 1942,             // optional hint
    "birthPlace": "Naples, Italy", // optional hint
    "sessionLanguage": "it",       // spoken prompts; default "en"
    "caregiverLanguage": "en",     // UI, tips, translations; default "en"
    "sessionMinutes": 20           // 5-60; default 20
  }
}
```

Response: `200`, NDJSON stream.

```text
{"type":"phase","phase":"parse","status":"started","message":"Reading your notes about Maria…","seq":0,"t":0}
{"type":"anchors","anchors":{"birthYear":1942,"formativeWindow":{"startYear":1952,"endYear":1972},…},"seq":1,"t":900}
{"type":"phase","phase":"parse","status":"completed","message":"Understood: Naples, 1952-1972…","durationMs":1050,"seq":4,"t":1050}
{"type":"candidate","candidate":{"id":"c_carosone","domain":"music","name":"Renato Carosone","qlooType":"urn:entity:artist","year":1956,"rationale":"…"},"seq":7,"t":2020}
{"type":"verified","entity":{"id":"ve_carosone","qlooId":"…","name":"Renato Carosone","provenance":"llm-proposed-qloo-verified",…},"seq":21,"t":4300}
{"type":"rejected","item":{"label":"Pino Daniele","reason":"Debuted in 1977, after her formative years.","kind":"anachronism","phase":"critique"},"seq":38,"t":8100}
{"type":"step","step":{"id":"s_carosone","order":2,"kind":"move","title":"…","prompt":"…","durationMin":3,"provenance":"qloo-grounded"},"seq":44,"t":9200}
{"type":"plan","plan":{"id":"…","mode":"grounded","steps":[…],"meta":{"revision":0,…}},"seq":51,"t":12700}
{"type":"done","traceId":"…","durationMs":12800,"stats":{"candidates":11,"verified":12,"rejected":4,"steps":8,"llmCalls":4,"qlooCalls":13,"cacheHits":0},"seq":53,"t":12800}
```

Modes:
- `grounded`: all six phases. Steps built on Qloo-verified entities carry `provenance:"qloo-grounded"` and `entity`.
- `llm-only`: `verify` and `expand` are emitted as `skipped`; every step has `provenance:"llm-only"` and no `entity`.
  `plan.meta.qlooMode` is `"unused"`.

**Comparison view:** the UI sends two requests with the same `person`, one per mode, in parallel, and renders them side by side.
With the input-keyed cache, the shared PARSE result is computed once.

## `POST /api/session/replan`

Adapts the rest of a running session to the person's reaction. Body: `ReplanRequest`.

```jsonc
{
  "plan": { /* the latest SessionPlan the client holds */ },
  "anchors": { /* the Anchors from the session stream */ },
  "stepId": "s_oro",            // the step the reaction is about
  "reaction": "upset",          // "lit_up" | "neutral" | "upset"
  "history": [{ "stepId": "s_sinatra", "reaction": "lit_up" }], // earlier reactions, oldest first
  "note": "She went quiet and looked away" // optional, <= 280 chars, never logged
}
```

Response: `200`, NDJSON stream: `phase(replan, started)`, `note`s, optional `verified` (new Qloo-backed
entities), optional `rejected` (`phase:"replan"`, for upcoming steps removed), `step` events for new or changed
steps, one `plan` with `meta.revision` incremented, `phase(replan, completed)`, `done`.

Semantics:
- Steps with `order <=` the reacted step's order are never changed (they already happened).
- `lit_up`: lean into that entity's thread (more of the same artist/era/domain, often via Qloo affinity from it).
- `neutral`: change domain or modality for the next step.
- `upset`: move to a calming, familiar step next, and drop upcoming steps that the LLM judges to be on a related risky theme.
- The new plan keeps `plan.id`; step ids of unchanged steps are preserved; `order` is re-numbered from 0.

## `GET /api/health`

Non-secret runtime status for the UI badge ("Demo data" vs "Live Qloo"). Uses `publicConfigSummary()`.

```json
{ "status": "ok", "qloo": { "mode": "mock", "mockReason": "missing_key", "baseUrl": "https://hackathon.api.qloo.com" },
  "llm": { "mode": "mock", "mockReason": "missing_key", "provider": "mock", "model": "mock-llm" },
  "cache": { "driver": "memory" } }
```
