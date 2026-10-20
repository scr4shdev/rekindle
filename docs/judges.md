# 90-second judge tour

Everything you need to see Rekindle work and feel the Qloo value in a minute and a half. Three paths, in priority order.

## Fast path (90 seconds)

1. Open the live demo (or `http://localhost:3000` after `npm run dev`).
2. On the landing page, tap the **Fatima** persona card (Fès and Brussels, French and Arabic). Fatima is first on purpose: she is the cross-cultural case, where a care aide has no shared culture to lean on, and where Qloo's taste graph is most clearly load-bearing.
3. Watch the live trace stream for about 5 seconds. The six-phase loop runs top-to-bottom. Each Qloo call narrates in plain English, for example *"Looking for Oum Kalthoum"* and *"Checking who else people who enjoy Oum Kalthoum and Abdelhalim Hafez tend to enjoy."* The extra `cultural-check` LLM pass runs for Fatima and drops Western-drift candidates (Donald Trump, the Beatles) that Qloo's expand step bled through. Expand a `qloo_call` row to see the exact endpoint and params that were sent (cultural anchors only).
4. When the plan appears, click **Compare** at the top of the page. The LLM-only plan loads on the left, the grounded plan on the right.
5. Look at the hero callout above both columns: *"Qloo caught N era/culture/risk slips and confirmed M real matches."* Numbers in sage.
6. Scroll the left (LLM-only) column until you see the rose-outlined steps. The badges say **"Would have slipped"**. These are hallucinated, era-slipped or Western-drift items the LLM alone would have put in a Fès elder's session. On the right (grounded) column, Qloo and the cultural-check LLM caught them.
7. For a cross-check on a shared-culture persona: tap **Maria** (Napoli, Italian) and watch the same loop run; the Maradona 1987 era catch is the signature moment there.

That is the thesis in one scroll.

## If anything flakes

The hackathon host, the LLM provider, or the network can all have a bad day. There is a judge-stable path that bypasses all three:

```
/session?persona=fatima&source=replay
```

This streams `tests/fixtures/trace-fatima.ndjson` through `GET /api/session/replay?fixture=fatima`. It runs in under 15 seconds, makes zero Qloo calls and zero LLM calls, and the output is byte-stable: the file's sha256 is pinned in `tests/fixtures/trace-fatima.meta.json` and verified in CI. The three available fixtures are `fatima`, `maria`, `seamus`.

The replay route exists on purpose: the demo keeps working even if Qloo rate-limits, an LLM key goes stale, or Vercel has a cold-start spike. The determinism contract (temperature 0, pinned model IDs, versioned prompts, input-keyed sha256 cache, injected `now` and `newId`) makes this safe to commit.

## Technical sanity checks

Two shell probes a judge can run against the live demo (or `localhost:3000`) to confirm the shape of the system.

### Health

```
curl -s $BASE/api/health | jq .
```

Expected shape:

```jsonc
{
  "status": "ok",
  "qloo": { "mode": "live" },     // or "mock" with no key
  "llm":  { "provider": "groq", "model": "<pinned>" }, // or { "mode": "mock" }
  "cache": { "driver": "memory" } // or "upstash", "layered"
}
```

The `x-trace-id` response header matches the trace id in server logs and in the final `done` event of a streaming run. In mock mode, LLM internals are redacted so a judge inspecting the Network tab does not see provider or model names (fix at `d4b6830`).

### Replay stream

```
curl -s "$BASE/api/session/replay?fixture=maria" | head -1
```

The first line is a `phase{status:"started"}` event stamped `seq: 0`, `t: 0`, with a `type: "phase"` discriminator. Every subsequent line is one `AgentEvent` JSON object validated against the frozen `src/lib/domain/types.ts#AgentEvent` schema. The last line is a `done` event with the trace id and the stats block (`candidates`, `verified`, `rejected`, `steps`, `llmCalls`, `qlooCalls`, `cacheHits`). Byte-stable across runs.

## What to look for

In priority order, these are the moves that most reward a close look.

- **The `qloo_call` rows in the trace.** Expand one. The params object has no personal data (no name, no notes, no device id), just cultural anchors (entity ids, tag ids, place, year filter, aggregate age bucket). That is `withPersonalDataGuard` enforcing HARD RULE 2 in `AGENTS.md` at the port boundary.
- **The Compare page catches.** The rose outline is only drawn when a grounded rejection matched the LLM-only step on a verified entity id or on a normalized title (fix at `44d81e4` tightened the matcher so Carosone's "Napoli Mia Bella" no longer false-positives on "Napoli" alone). Maradona 1987 still correctly flags.
- **The Italian/French plan content for Maria and Fatima.** Prompts and translations stream in the person's own language; the caregiver chrome stays in English. If the person speaks Neapolitan dialect, the plan knows.
- **The three big reaction buttons in bedside mode.** Tap **Start session**, then **Try something different**. Watch the trace show *"They seemed upset. Slowing down with something calm and familiar."* The replan rewrites upcoming steps.

Full code tour: [`docs/ARCHITECTURE.md`](ARCHITECTURE.md). HTTP contract: [`docs/api.md`](api.md). Qloo field notes: [`docs/qloo-api.md`](qloo-api.md).
