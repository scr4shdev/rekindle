# Submission requirements and how Rekindle meets them

Sources: `qloo-hackathon-kit/docs/SUBMISSION.md`, `docs/SAFE_USE.md`, `docs/API_ACCESS.md` (cloned 2026-10-18 to
`~/qloo-hackathon-kit`), the hackathon email (base URL, data rules), and the event brief (deadline **2026-10-30**; judged on
Technological Implementation, Design, Potential Impact, Quality of Idea; judges click a live web app, no video).

## Required items (SUBMISSION.md)

| # | Requirement (quoted or summarized) | Rekindle deliverable | Owner | Status |
|---|---|---|---|---|
| 1 | "A short product problem statement." | README "Why" section plus the landing page hero | Integrator | todo |
| 2 | "The Qloo workflow or MCP tools used and why they fit the problem." | README "How Qloo is used": `/search` (verify, like `describe`), `/v2/insights` with era filters (expand, like `recommend` plus era), `/v2/tags` (decade tags, like `find_tags`); `qloo exec describe/recommend/find_tags` used for the parity check (docs/qloo-api.md section 8) | Integrator, W-CORE | todo |
| 3 | "A redacted request-to-result explanation, including any entity/tag choices." | The live trace shows every Qloo request (`qloo_call` events: endpoint plus params, which contain only cultural anchors) next to the entities it returned and the rejected items with reasons. README walkthrough for the Maria persona | W-UI, Integrator | todo |
| 4 | "A short demo or screenshots that contain no credential or personal data." | Live app with 3 fictional personas; screenshots in README; nothing personal is ever entered in demos | Integrator | todo |
| 5 | "Setup steps another participant can run from a clean environment." | README "Run locally": `npm ci && npm run dev` works with **no keys** (mock mode); `.env.example` documents live mode | Integrator | done (skeleton) |
| 6 | "Known limitations, including what the result does not establish." | README "Limitations": Qloo affinities are aggregate, not personal; not medical; data coverage gaps (e.g. no dish type, artists have no year filter); LLM mistakes remain possible, so the caregiver stays in charge | Integrator | todo |

Judging lens named in SUBMISSION.md: "usefulness, technical execution, provenance and user clarity, responsible data handling,
and reproducibility". Projects are stronger when "Qloo results [are used] as evidence in a clear product flow rather than showing
an isolated API response". This is what the grounded-vs-LLM-only comparison and the provenance badges are for.

## Hard rules (must hold at submission)

- [ ] Qloo key only on the server (`src/lib/config.ts`); not in client bundles, the repo, logs, screenshots or recordings.
      Check: `grep -r QLOO_API_KEY .next/static` is empty after a build; gitleaks CI job is green.
- [ ] No personal data sent to Qloo (names, emails, device ids, account ids, location histories). Enforced by the strict
      TastePort query schemas and `withPersonalDataGuard`; covered by `tests/contract/taste-port.test.ts` and W-CORE unit tests.
- [ ] Results presented as aggregate affinities ("people who enjoy Sinatra also tend to enjoy…"), with the source shown
      (badge `Qloo-grounded` vs `LLM-only`) and kept separate from our own interpretation (LLM rationale).
- [ ] Non-medical framing everywhere ("activity", not "therapy"), with a disclaimer on every plan.
- [ ] Nothing the caregiver types is stored: no database, no plaintext in logs or remote caches.
- [ ] Cached or recorded live Qloo data is not committed to a public repo (`.qloo-recordings/` is git-ignored; committed fixtures are hand-authored).
- [ ] Bounded retries, caching and the smallest useful requests (API_ACCESS.md: respect the quota, no bulk scraping).
- [ ] The base URL is `https://hackathon.api.qloo.com` (hackathon keys work only there).

## Open questions for the organizers

1. Is calling the documented HTTP endpoints directly from a serverless backend with the event key acceptable, given that the kit lists
   the harness commands as the "supported surfaces"? (Our reasons and the parity check: docs/qloo-api.md section 8.)
2. The published event quota and rate limit (API_ACCESS.md says organizers will publish them).
3. Whether the event rubric weights (Technological Implementation, Design, Potential Impact, Quality of Idea) come with prizes or tracks.
