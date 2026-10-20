# No regex or keyword lists for semantics

This repo bans regex (and keyword lists dressed up as `Set<string>`) from
semantic decisions. The ban is spelled out in `AGENTS.md`:

> **No regex or keyword lists for semantics.** All meaning (parsing notes,
> classifying, safety judgment, era inference, disambiguating search results)
> goes through the LLM via schema-validated structured output
> (`LlmPort.generateObject`). Deterministic code only reshapes already-
> structured data (mapping JSON, sorting, filtering by year numbers, exact-
> equality checks on normalized names, building query strings).

This file is the audit baseline. A reviewer can grep for new regex and
classify each against the table below. Any new hit that cannot be filed as
**D**, **V** or **R** must go through the LLM.

## Classification

- **S (semantic)**: the regex or keyword set is interpreting meaning. Illegal.
  Examples: "does this heading mean cultural background?", "is this token a
  generic place name?", "does this title sound like the rejected concept?",
  "is this a religious term?".
- **D (deterministic shape)**: the regex reshapes already-structured data.
  Allowed. Examples: pull a year out of `"1958-01-01"`, split on whitespace,
  strip a trailing slash, extract the 2-letter subtag from `"en-GB"`, check an
  ISO country-code shape, Unicode-fold accents.
- **V (validation)**: a zod `.regex()` format validator for a well-defined
  string shape. Allowed. Examples: BCP-47 language tag, UUID, sha256.
- **R (rendering)**: a UI mechanic. Allowed. Examples: splitting on
  whitespace to break a line, escaping markdown punctuation.

## Classified regexes kept in the tree

| File:line | Pattern | Class | Why |
|---|---|---|---|
| `src/app/api/tts/route.ts:29` | `z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/u)` | V | BCP-47 primary subtag format for the TTS body. |
| `src/app/for-operators/page.tsx:338` | `/[^a-z0-9]+/g`, `/^-\|-$/g` | D | Slugify a heading for an in-page anchor. |
| `src/components/compare/would-slip.ts` | `/[^\p{L}\p{N}\s]/gu`, `/\s+/u` | D | Tokenize a title into Unicode words. The surrounding comparison is pure set-overlap now (see "Removed" below). |
| `src/components/session/qloo-citation.ts:37` | `/^\(/`, `/\)$/` | D | Strip leading/trailing parentheses from a disambiguation string. |
| `src/components/session/rejection-display.ts:34` | `/^cultural_mismatch\s*:\s*/i` | D | Strip a known sentinel prefix our own LLM pipeline emits. The reason text's shape is structured, the sentinel is a tag. |
| `src/components/session/step-card.tsx:44` | `/^https?:\/\//.test(rawSrc)` | D | URL protocol check before passing to an `<img>` src. |
| `src/components/session/use-speak.ts` | `shortLang` BCP-47 primary subtag strip | D | Extract `"en"` from `"en-GB"`. |
| `src/lib/adapters/qloo/http.ts:70` | `/\s+/g` | D | Collapse whitespace in an alias key before an exact lookup. |
| `src/lib/adapters/qloo/mapping.ts:66` | `/^\d{4}/.test(date)` | D | Extract the leading year from an ISO date string. |
| `src/lib/adapters/qloo/mock.ts:27-35` | `/\p{M}/gu`, `/[‘’ʼ]/g`, `/[^\p{L}\p{N}]/gu` | D | Unicode-fold a name before an exact-equality lookup in the mock graph. |
| `src/lib/adapters/llm/ollama.ts:94, 249` | `/\/+$/` | D | Trim trailing slash from a base URL before concatenation. |
| `src/lib/agent/phases/parse-propose.ts:86` | `/^[A-Za-z]{2}$/` | D | ISO 3166-1 alpha-2 shape check before upper-casing a country code. |
| `src/lib/agent/util.ts:20-24, 160` | `/\p{M}/gu`, `/[‘’ʼ]/g`, `/\s+/u` | D | Unicode-fold a name for exact-equality normalization. |
| `src/lib/composition.ts:251` | `/\/+$/` | D | Trim trailing slash from the Ollama base URL. |
| `src/lib/config.ts:182, 201` | `/\/+$/` | D | Trim trailing slash from `QLOO_BASE_URL` and `OLLAMA_BASE_URL`. |
| `src/lib/logger.ts:38` | `/^[a-zA-Z_$][\w$]*$/` | D | JavaScript identifier shape check for a dotted log-key path. |
| `tests/unit/golden.test.ts:47, 68, 70, 74, 91` | word boundary + `/^(c\|ve\|s\|plan)_\d+$/` + quiz phrases | R (test) | Backstop assertions in a golden test: forbidden words, ID shape, no quiz phrasing. Not production semantic code. |
| `tests/unit/mock-prompts-quiz.test.ts` + `tests/contract/domain.test.ts:56` | quiz phrasing | R (test) | Contract-side backstop that the mock output stays invitational. Not production code. |

## Removed in this change

| File | Was | Why removed |
|---|---|---|
| `src/components/landing/custom-form.tsx` (PASTE_PATTERNS, applyPaste) | Six arrays of regexes that classified free-text headings ("cultural background", "key life events", etc.) and pulled bodies between them. | **S**. Classifying a line as a heading of a given field is semantic. The notes textarea now takes the full "This is Me" sheet and the server-side `parse-anchors` prompt reads it with a schema-validated output. |
| `src/components/compare/would-slip.ts` (SLIP_STOP_TOKENS, SLIP_YEAR_RE, isSlipStopToken) | A hand-authored stop list of place names and demo first names, plus a bare-year regex, so a single "napoli" or "1958" overlap would not flag. | **S**. The stop list was a keyword list for semantics (deciding which tokens are "generic"). Replaced by pure set overlap with a minimum of two shared tokens. Reinstating single-token flagging would need a new LLM prompt on the server. |

## Policy for new regex

Before adding a regex, classify it against the table above and add it there in
the same commit. If the honest classification is **S**, the fix is one of:

1. Delete the behaviour (if the demo cost is acceptable).
2. Hand the decision to an existing prompt module in `src/lib/prompts/` and
   consume its structured output.
3. Add a new prompt module (ID, VERSION, zod schema, system message, render
   function) and wire it into the appropriate phase or route.

Never add a `Set<string>` of "generic words" or "known safe terms" as a
workaround: that is a keyword list for semantics under a different name.
