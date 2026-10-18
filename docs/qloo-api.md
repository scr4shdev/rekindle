# Qloo Insights API: reference for Rekindle

Researched 2026-10-18 from documentation only; no API key was available, so **no live call was made**.
Everything marked **CONFIRMED** is quoted from a source listed below. **UNCERTAIN** means it was
missing from the docs, the docs contradict each other, or it is an inference. Validate those once a key arrives.

Sources (all fetched 2026-10-18; ReadMe pages read via the `.md` suffix, e.g. `https://docs.qloo.com/reference/get-search.md`):
- `docs.qloo.com/reference/qloo-llm-hackathon-developer-guide` (updated 2026-10-07): base URL, auth, errors, types
- `.../api-overview`, `.../insights-api-deep-dive` (embedded OpenAPI 3.1 for `/v2/insights`), `.../parameters`,
  `.../available-parameters-by-entity-type`, `.../parameter-overview`, `.../get-search`, `.../get-entities`,
  `.../search-tags` (`/v2/tags`), `.../get-tag-types`, `.../get-audiences`, `.../get-audience-types`,
  `.../get-trending`, `.../analysis-compare`, `.../api-information`, `.../schema-taxonomy`,
  `.../basic-insights-use-case`, `.../insights-with-location-use-case`, `.../demographics-use-case`,
  `.../heatmaps-use-case`, `.../taste-analysis`, `.../api-onboarding`, recipe `docs.qloo.com/recipes/recommendations-for-restaurants-similar-to-balthazar-in-nyc`
- `github.com/qloo/qloo-hackathon-kit` (README, docs/, starters) and the code of the npm package it installs,
  `@qloo/qloo-harness@0.1.26`. I read its `dist/` as data and did not run it. Its pinned contract (`upstream.lock.json`)
  lists the real GET paths and how it parses responses.
- No `llms.txt` exists (404). `docs.qloo.com/openapi.json` returns 404. The per-page OpenAPI JSON is embedded in each reference page.

---

## 1. Base URLs, auth, limits, errors

| Item | Value | Status |
|---|---|---|
| Hackathon base URL | `https://hackathon.api.qloo.com` | CONFIRMED (dev guide: "Your key is valid only against the hackathon base URL") |
| Production | `https://api.qloo.com` (the `servers` entry in every OpenAPI page) | CONFIRMED |
| Staging | `https://staging.api.qloo.com` (used in many doc curl examples) | CONFIRMED to exist. Hackathon keys "do not work" here |
| Auth header | `X-Api-Key: <key>` (OpenAPI `securitySchemes.ApiKey`: `in: header, name: X-Api-Key`) | CONFIRMED. Not a Bearer token, not a query param |
| Method | GET for all documented paths; params go in the query string | CONFIRMED ("`/v2/insights` is a GET request ... POST with JSON body will fail") |
| Array params | Comma-separated in one query value (`style: form, explode: false`) | CONFIRMED (harness joins arrays with `,`) |
| Image host | `https://images.qloo.com/i/<UUID>-420x-auto.jpg` (staging examples use `staging.images.qloo.com`, `-420x-outside.jpg`) | CONFIRMED as examples. The size suffix may vary |

**Base-URL conflict (UNCERTAIN):** the current hackathon kit's harness (`@qloo/qloo-harness@0.1.26`) defaults to
`https://api.qloo.com` and treats only that host as "official" (`isOfficialQlooBaseUrl`). It never mentions `hackathon.api.qloo.com`.
The docs dev guide says hackathon keys work **only** on `hackathon.api.qloo.com`. Make the base URL an env var
(`QLOO_BASE_URL`, default `https://hackathon.api.qloo.com`) and test both with the issued key. A wrong host returns **401**.

**Rate limits and quotas:** no numbers are published. The dev guide says: "Hackathon API keys have rate and monthly quota limits
set high enough... limits can be raised on a per-user basis" (ask in Discord #api-help). Keys deactivate after judging.
The OpenAPI pages declare a `429 Rate limit exceeded` response. The harness retries 429/500/502/503/504 up to 3 attempts, honours
`Retry-After`, and uses a 20 s timeout. Server-side caching is explicitly allowed, with no time limit, but cached data
must not be committed to a public repo.

**Error shapes (CONFIRMED from the OpenAPI `404`/`429` schemas plus dev-guide messages):**
```json
{ "code": 400, "reason": "Bad Request", "message": "entity_ids must be specified." }
```
| Status | Documented cause / message |
|---|---|
| 401 | Wrong base URL for the key, or `"No API key found in request"` (header missing or misnamed) |
| 403 | `"You do not have permission to access urn:entity:..."`: unsupported `filter.type` |
| 400 | `"at least one valid signal or filter is required"` (for example, free-text tag strings instead of tag IDs). Also returned when `*.location.query` or `*.entities.query` resolves nothing |
| 404 | `"No path matching request parameters"` (wrong method or path, e.g. `/v2/insights/search`) |
| 200 + empty `results.entities` | **Unsupported params are silently ignored**, or there is no data for that entity/region |

Health/info: `GET /` returns `{version, title, description, contact{name,url,email}}` (CONFIRMED, `api-information`).
Status page: https://status.qloo.com/. **Legacy `/recommendations` and `/recs` are not supported** in the hackathon.

Full list of GET paths pinned by the harness: `/`, `/entities`, `/search`, `/v2/analysis/compare`,
`/v2/audiences`, `/v2/audiences/types`, `/v2/insights`, `/v2/tags`, `/v2/tags/types`, `/v2/trending`.

---

## 2. Entity search: `GET /search`

Params (CONFIRMED, `get-search` OpenAPI):

| Param | Type | Notes |
|---|---|---|
| `query` | string | Text to search (example `Beyonce`) |
| `types` | comma list | Enum: `urn:entity:artist, book, brand, locality, movie, person, place, podcast, tv_show, videogame`, `urn:heatmap`, `urn:entity:audience` (deprecated). **Search-only legacy types:** `urn:entity:actor`, `urn:entity:album`, `urn:entity:author`, `urn:entity:director`, `urn:entity:locality` |
| `filter.location` | string | `lat,lon`, WKT (`POINT(-73.99 40.72)`), or a Qloo entity UUID |
| `filter.radius` | number | Miles, default 10, max 100 (geo categories only) |
| `filter.tags` | comma list | Tag IDs, combined with `operator.filter.tags` = `union` (default) or `intersection` |
| `filter.popularity` | number 0–1 | Minimum popularity |
| `filter.rating` | number 0–5 | Minimum business rating |
| `filter.exists` | comma list | e.g. `external.resy`, `external.michelin` |
| `filter.address` | string | Partial match |
| `page` | int 1–100 | Default 1 |
| `take` | int | `exclusiveMaximum: 200`; default not stated (UNCERTAIN) |
| `sort_by` | `match` (default), `distance`, `popularity` | |

```bash
curl -s -H "X-Api-Key: $QLOO_API_KEY" \
  "https://hackathon.api.qloo.com/search?query=Frank%20Sinatra&types=urn:entity:artist&take=5"
```

Response: the OpenAPI declares a **top-level `results` array** (not `results.entities`) next to `success` and `duration`.
The item schema is an unresolved `$include` (`Common.yml` + `UniqueToArtist/Movie/TV/Videogame/Geolocational.yml`),
so **the exact item fields are UNCERTAIN**. The harness handles both `results[]` and `results.entities[]`, `entity_id` or `id`,
and `subtype`, `type`, or a `types[]` array. Expected shape, assuming it mirrors insights entities:
```jsonc
{ "success": true, "duration": 0.1,
  "results": [ { "entity_id": "UUID" /* or "id"? */, "name": "Frank Sinatra",
                 "types": ["urn:entity:artist"] /* or subtype? */, "popularity": 0.99,
                 "disambiguation": "...", "properties": { "image": { "url": "..." }, "short_description": "..." },
                 "tags": [ { "id": "urn:tag:genre:music:jazz", "name": "Jazz", "type": "urn:tag:genre:music" } ] } ] }
```
**Defensive TS parse:** `items = Array.isArray(r.results) ? r.results : r.results?.entities ?? []`;
`id = it.entity_id ?? it.id`; `type = it.subtype ?? it.type ?? it.types?.find(t => t.startsWith('urn:entity:'))`.

### `GET /entities` (lookup by ID): CONFIRMED path

Params: `entity_ids` (comma list of UUIDs), or external IDs: `external.imdb.ids`, `external.spotify.ids`,
`external.musicbrainz.ids`, `external.wikidata.ids`, `external.isbn13.ids`, `external.goodreads.ids`, `external.lastfm.ids`,
`external.itunes.ids`, `external.igdb.ids`, `external.rottentomatoes.ids`, `external.metacritic.ids`, `external.twitter.ids`,
`external.instagram.ids`, `external.facebook.ids`, `external.library_of_congress.ids`, `external.michelin.ids`,
`external.resy.ids`, `external.tablet.ids`, `external.twitch.ids`, `external.soundcloud.ids`, `external.isbn10.ids`,
`external.goodreads_author.ids`. Response: same envelope as `/search` (top-level `results[]`, so the shape is UNCERTAIN in the same way).
```bash
curl -s -H "X-Api-Key: $QLOO_API_KEY" \
  "https://hackathon.api.qloo.com/entities?entity_ids=E12201A5-CC50-40AF-97AE-C54A2CA303F7,F6754C46-B3E7-457F-8B7E-06C613597320"
```
Lookup by Wikidata or Spotify ID could help verify LLM-proposed entities (UNCERTAIN: coverage and ID format, e.g. `Q83808444` vs `q83808444`; the
insights example shows lowercase `"wikidata":[{"id":"q83808444"}]`).

---

## 3. `GET /v2/insights`

### 3.1 `filter.type` (required)
Hackathon dev guide list (CONFIRMED text): `urn:entity:artist`, `urn:entity:book`, `urn:entity:brand`,
`urn:entity:destination`, `urn:entity:movie`, `urn:entity:person`, `urn:entity:place`, `urn:entity:podcast`,
`urn:entity:tv_show`, `urn:entity:video_game`.

Other values documented elsewhere: `urn:heatmap` (heatmaps), `urn:tag` (taste analysis), `urn:demographics`
(demographics), `urn:entity:locality` (partial: only `signal.interests.entities` of localities), `urn:entity:audience` (deprecated).
Deprecated `filter.type` values with their own param tables: `urn:entity:actor`, `urn:entity:author`, `urn:entity:director`
(the docs say to use `person`). **There is no `album`, `food`, `dish`, `music`, `food_and_drink`, `sports_team` or `team` type.**
The dev guide says: "Music: use `urn:entity:artist`, not `urn:entity:music`", and "Food and beverage places: use `urn:entity:place` or `urn:entity:brand`".

**UNCERTAIN, video games:** the dev guide writes `urn:entity:video_game`, but the insights OpenAPI enum, the `/search` enum,
the trending and compare enums, the schema taxonomy and the harness all use **`urn:entity:videogame`**. Prefer `videogame`.
**UNCERTAIN, destination:** it appears in the dev guide and the entity-type guide but **not** in the insights OpenAPI enum or the harness type list.

### 3.2 Signals (what drives ranking)
| Param | Format | Status |
|---|---|---|
| `signal.interests.entities` | comma list of entity UUIDs (POST variant: `[{entity, weight}]`, but GET is the documented hackathon method) | CONFIRMED, all types |
| `signal.interests.entities.weight` | number ≥0 or `very_low, low, mid, medium, high, very_high` | CONFIRMED (OpenAPI) |
| `signal.interests.tags` | comma list of tag IDs; `operator.signal.interests.tags` = `union`/`intersection` (the reference says empty means intersection) | CONFIRMED |
| `signal.location` | WKT POINT/POLYGON (lon first) or a locality UUID | CONFIRMED in the parameter reference "for all types". **Absent** from every per-type table in the entity-type guide (UNCERTAIN) |
| `signal.location.query` | fuzzy locality name ("Naples", "Lower East Side") → `query.locality.signal` in response; 400 if not found | CONFIRMED. The doc example uses it with `filter.type=urn:entity:movie` |
| `signal.location.radius` (m, max 800000), `signal.location.weight` | | CONFIRMED (OpenAPI) |
| `signal.demographics.age` | comma list. Reference: `24_and_younger, 25_to_29, 30_to_34, 35_to_44, 45_to_54, 55_and_older`. OpenAPI enum also has `35_and_younger, 36_to_55` | CONFIRMED. For an ~84-year-old use `55_and_older` (the oldest bucket) |
| `signal.demographics.gender` | `male` or `female` | CONFIRMED |
| `signal.demographics.audiences` (+`.weight`) | audience IDs from `/v2/audiences` | CONFIRMED |
| `bias.trends` | `off, very_low, low, mid, medium (default), high, very_high` | CONFIRMED. Use `off` or `low` for nostalgic results |
| `bias.content_based` | 0–1, default 0.5 | CONFIRMED (OpenAPI only) |

### 3.3 Filters (which entities are eligible)
CONFIRMED per the entity-type guide matrix. A = artist, Bk = book, Br = brand, D = destination, M = movie, Pe = person, Pl = place, Po = podcast, TV = tv_show, VG = videogame.

| Filter | Applies to |
|---|---|
| `filter.tags`, `operator.filter.tags`, `filter.exclude.tags`, `operator.exclude.tags` | all entity types |
| `filter.exclude.entities`, `filter.results.entities`, `filter.results.entities.query` | all entity types |
| `filter.popularity.min` / `.max` (0–1 percentile) | all entity types |
| `filter.external.exists` (+operator), `filter.parents.types` | all entity types |
| **`filter.release_year.min` / `.max`** (int) | **M, TV only** |
| `filter.release_country` (+`operator.filter.release_country`) | M, TV (e.g. `Italy`; exact string format is UNCERTAIN) |
| `filter.content_rating`, `filter.rating.min/max` | M, TV |
| `filter.finale_year.*`, `filter.latest_known_year.*` | TV |
| **`filter.publication_year.min` / `.max`** | **Bk** |
| **`filter.date_of_birth.min/max`**, `filter.date_of_death.*` (YYYY-MM-DD), `filter.gender` | **Pe** |
| `filter.location`, `filter.location.query`, `filter.location.radius` (m, default 15000, max 800000), `filter.location.geohash`, `filter.exclude.location*` | D, Pl (also heatmap) |
| `filter.geocode.name` / `admin1_region` / `admin2_region` / `country_code` (exact match) | D, Pl |
| price/hotel/resy/tripadvisor/hours/address/`filter.references_brand`, `bias.quality`, `sort_by` | Pl |
| `filter.release_date.min/max` (YYYY-MM-DD) | in the reference and OpenAPI, but **no compatible types listed** (UNCERTAIN; probably M/TV) |
| `filter.exists` = `properties.image` or `properties.description` | OpenAPI only (UNCERTAIN per type). Useful to guarantee images |

**No era/date filter exists for artist, brand, podcast or videogame.** There is no `filter.geocode.*` or `filter.location*` for media types.

### 3.4 Output / paging
`take` (default 20, **max 50**), `page` (1–100, recommended), `offset`, `feature.explainability=true` (adds per-result
`query.explainability` showing which input entities contributed, scores 0–1, plus a top-level `query.explainability`),
`diversify.by` / `diversify.take`, `backfill.cross_domain.take` (≤20) / `backfill.content_based.take` (≤10).
**There is no field-selection param**: "The API returns the full response" (with verbose `akas`). Strip fields server-side.

### 3.5 Example call and response
```bash
curl -s -H "X-Api-Key: $QLOO_API_KEY" -G "https://hackathon.api.qloo.com/v2/insights" \
  --data-urlencode "filter.type=urn:entity:movie" \
  --data-urlencode "signal.interests.entities=<SINATRA_UUID>" \
  --data-urlencode "filter.release_year.min=1952" --data-urlencode "filter.release_year.max=1972" \
  --data-urlencode "signal.location.query=Naples" \
  --data-urlencode "signal.demographics.age=55_and_older" \
  --data-urlencode "bias.trends=off" --data-urlencode "take=10" --data-urlencode "feature.explainability=true"
```
Response (doc-quoted and abbreviated; merges `basic-insights-use-case`, the Balthazar recipe for `query.affinity`, and the location use case):
```jsonc
{
  "success": true,
  "results": {
    "entities": [
      {
        "name": "Everything Everywhere All at Once",
        "entity_id": "F0D354AA-BA7E-49D2-8ABA-9A8250F5C852",
        "type": "urn:entity",                    // always "urn:entity"
        "subtype": "urn:entity:movie",           // <- the real domain type
        "properties": {
          "release_year": 2022, "release_date": "2022-04-08",
          "description": "...", "content_rating": "R", "duration": 139,
          "image": { "url": "https://staging.images.qloo.com/i/F0D354AA-...-420x-outside.jpg" },
          "akas": [ { "value": "...", "languages": ["hu"] } ],
          "short_descriptions": [ { "value": "amerikansk film fra 2022", "languages": ["nb"] } ],
          "release_country": ["United States"], "production_companies": ["A24"], "websites": ["..."]
        },
        "popularity": 0.9984116946335868,
        "tags": [ { "id": "urn:tag:keyword:media:multiverse", "name": "Multiverse", "type": "urn:tag:keyword:media" } ],
        "query": { "affinity": 0.97, "measurements": { "audience_growth": -0.0407 } },
        "disambiguation": "2022, Daniel Scheinert, Daniel Kwan",
        "external": { "imdb": [ { "id": "tt6710474", "user_rating": 7.8 } ], "wikidata": [ { "id": "q83808444" } ] }
      }
    ]
  },
  "query": { "locality": { "signal": { /* matched locality entity */ } }, "explainability": { /* if requested */ } },
  "duration": 34
}
```
Exact JSON paths:
- ID: `results.entities[i].entity_id`
- name: `.name`
- domain: `.subtype` (`.type` is just `"urn:entity"`)
- image: `.properties.image.url`
- year: `.properties.release_year` for movie/TV (fallback: parse `.properties.release_date`)
- affinity: `.query.affinity`. It is absent when there is no signal (e.g. a filter-only request): the doc examples without signals show only `query.measurements`
- popularity: `.popularity`
- growth: `.query.measurements.audience_growth`

**UNCERTAIN raw paths per type.** The `schema-taxonomy` page shows a **flattened** view (`url`, `affinity`, `release_year`,
`publication_year`, `date_of_birth` at the top level), and that is not the raw API shape. By analogy, expect
`properties.publication_year` (book), `properties.date_of_birth` / `properties.place_of_birth` (artist, person),
`properties.short_description` (the harness reads both `short_description` and `description` from `properties`).

---

## 4. Tags, audiences

### `GET /v2/tags` (search tags): CONFIRMED path
Params: `filter.query` (partial string), `feature.typo_tolerance` (bool), `feature.semantic_search` (bool, beta; the harness uses
it with `take=20`), `filter.tag.types` (comma list, exact, e.g. `urn:tag:genre:music`), `filter.results.tags`,
`filter.parents.types` (the OpenAPI enum lists only `urn:audience:*` values; **whether `urn:entity:artist` etc. works here is UNCERTAIN**),
`filter.popularity.min/max`, `page`, `take` (default 20, max 50). There is **no `filter.type` param**. Response: `{success, duration, results:{tags:[...]}}`.
Item fields are not specified. The harness reads `id ?? tag_id`, `name`, `type ?? subtype`, `parents[].type`, `popularity`, and `affinity ?? query.affinity`.
```bash
curl -s -H "X-Api-Key: $QLOO_API_KEY" -G https://hackathon.api.qloo.com/v2/tags \
  --data-urlencode "filter.query=italian" --data-urlencode "feature.semantic_search=true" --data-urlencode "take=10"
```
`GET /v2/tags/types`: lists tag types per entity type. Params are only `filter.parents.types`, `page` and `take`; the response shape is undocumented.
Known tag namespaces (taxonomy page): `urn:tag:genre:music:*` (incl. **`urn:tag:genre:music:60s`**, `urn:tag:genre:music:eighties`,
`jazz`, `classical`, `singer_songwriter`...), `urn:tag:genre:media:*` (movies/books/TV), `urn:tag:keyword:media:*`,
`urn:tag:genre:brand:*` (incl. **`urn:tag:genre:brand:sports_organization:soccer`**, `...:food_and_beverage`),
`urn:tag:genre:place:restaurant:italian` and other cuisines, `urn:tag:genre:person:athlete` and `urn:tag:occupation:person:*`, `urn:tag:wikipedia_category:wikidata:*`.
The decade tags `50s`/`fifties`/`70s`/`seventies` were not listed (UNCERTAIN; search for them).

Tag insights (taste analysis): `GET /v2/insights?filter.type=urn:tag&signal.interests.entities=<id>&filter.tag.types=...`
→ `results.tags[]` with `tag_id, name, types[], subtype, tag_value, query{}` (CONFIRMED example).

### `GET /v2/audiences`, `GET /v2/audiences/types`
`/v2/audiences` params: `filter.query`, `filter.audience.types`, `filter.parents.types` (`urn:audience:communities | global_issues |
hobbies_and_interests | investing_interests | leisure | life_stage | lifestyle_preferences_beliefs | political_preferences |
professional_area | spending_habits`), `filter.results.audiences`, `filter.popularity.*`, `page`, `take`. The response is documented as
`results.entities[]` (fields unspecified). The IDs feed `signal.demographics.audiences`. They have low relevance for Rekindle; skip them, partly because of SAFE_USE (below).

---

## 5. Other endpoints (brief)
- **Heatmap:** `GET /v2/insights?filter.type=urn:heatmap&filter.location.query=NYC&signal.interests.tags=...` → `results.heatmap[]`
  of `{location:{latitude,longitude,geohash}, query:{affinity, affinity_rank, popularity}}`. Optional `output.heatmap.boundary`
  (geohashes by default; city or neighborhood) and `heatmap.dimensions`. CONFIRMED.
- **Demographics:** `filter.type=urn:demographics&signal.interests.entities=<id>` → `results.demographics[]` of
  `{entity_id, query:{age:{"24_and_younger":0,..,"55_and_older":-0.17}, gender:{male,female}}}`. CONFIRMED (example).
- **Trending:** `GET /v2/trending` (**not** `/trends`). Required: `filter.type`, `filter.start_date`, `filter.end_date` (YYYY-MM-DD).
  Plus `signal.interests.entities`, `take`, `page`, `offset` → `results.trending[]` of `{date, population_percentile,
  population_rank, population_rank_velocity, velocity_fold_change, population_percent_delta}` (weekly, descending). CONFIRMED.
- **Compare:** `GET /v2/analysis/compare` (**not** `/v2/insights/compare`). Required: `a.signal.interests.entities`, `b.signal.interests.entities`.
  Optional: `filter.type`, `filter.subtype` (`urn:tag:occupation` | `urn:tag:genre`), `model` (`descriptive` | `predictive`), `take`, `page`, `filter.location.query`...
  The response schema is an unresolved include (UNCERTAIN).

---

## 6. Implications for Rekindle
Scenario: a person born in 1942 in Naples who loved Sinatra and football. Formative years were about 1952–1972 (ages 10–30).

**(a) Verify LLM-proposed era entities: SUPPORTED** via `/search`, one call per candidate:
```
GET /search?query=Frank%20Sinatra&types=urn:entity:artist&take=5
GET /search?query=La%20dolce%20vita&types=urn:entity:movie&take=5
GET /search?query=Totò&types=urn:entity:person&take=5          # public figures, actors
GET /search?query=SSC%20Napoli&types=urn:entity:brand&take=5   # sports clubs are brands (UNCERTAIN coverage)
GET /search?query=Diego%20Maradona&types=urn:entity:person&take=5
```
Matching rule, adapted from the harness: accept only a case/NFKC-normalised exact name match. If there are several, disambiguate by
`properties.release_year`, `disambiguation` or `properties.date_of_birth`. Otherwise treat it as unverified. **Do not pass unresolved names onward.** For movies, check
`properties.release_year` within 1952–1972 to confirm era plausibility. Batch-verify known IDs with `/entities?entity_ids=a,b,c`.

**(b) Cross-domain affinity from verified seeds: SUPPORTED** (cross-domain is explicit in the taxonomy docs, e.g. a brand input yielding movies, artists and people):
```
# era movies liked by Sinatra fans, localised to Naples
GET /v2/insights?filter.type=urn:entity:movie&signal.interests.entities=<SINATRA>,<NAPOLI>
    &filter.release_year.min=1952&filter.release_year.max=1972&signal.location.query=Naples
    &signal.demographics.age=55_and_older&bias.trends=off&filter.exists=properties.image&take=10
# TV of the era (release_year supported for TV)
GET /v2/insights?filter.type=urn:entity:tv_show&...same signals...&filter.release_year.min=1952&filter.release_year.max=1975
# books of the era
GET /v2/insights?filter.type=urn:entity:book&signal.interests.entities=<SINATRA>&filter.publication_year.min=1945&filter.publication_year.max=1972
# era public figures (singers, actors, athletes) by birth date
GET /v2/insights?filter.type=urn:entity:person&signal.interests.entities=<SINATRA>&filter.date_of_birth.min=1900-01-01&filter.date_of_birth.max=1950-12-31
# artists: NO year filter -> use decade/genre tags and/or popularity, then post-filter
GET /v2/insights?filter.type=urn:entity:artist&signal.interests.entities=<SINATRA>&filter.tags=urn:tag:genre:music:60s&bias.trends=off
# food: places (restaurants) near the hometown, Italian cuisine
GET /v2/insights?filter.type=urn:entity:place&signal.interests.entities=<SINATRA>&filter.location.query=Naples
    &filter.tags=urn:tag:genre:place:restaurant:italian&take=10
```
Gaps:
- **No era filter** for artist, brand, place, podcast or videogame. For artists use tags (`urn:tag:genre:music:60s`, `jazz`, `classic...`;
  look up whether a `50s` tag exists via `/v2/tags`) and post-filter on `properties.date_of_birth` (UNCERTAIN path). For brands, `founded_year` is only a property, so post-filter on it.
- `filter.release_country=Italy` can bias movies and TV toward Italian titles (UNCERTAIN value format).
- `signal.location*` on non-place types: the parameter reference says all types, and the doc example uses movie, but the
  entity-type guide omits it everywhere, and **unsupported params are silently ignored**. Validate it by diffing results with and without it.
- The hackathon data may be thin for Naples or Italy ("may not have data for every entity or region").
- **Food/dish is not an entity type.** Only `place` (restaurants with cuisine tags, location-filterable) and `brand`
  (`urn:tag:genre:brand:food_and_beverage`) exist. Dishes such as pizza or sfogliatella must stay LLM-only content, or be mapped to tags (search `/v2/tags?filter.query=pizza`).
- **Person covers public figures**, documented as "entertainers, athletes, politicians". `urn:tag:genre:person:athlete` exists,
  so footballers (e.g. Maradona, Sivori) should be `urn:entity:person`.
- **Sports teams:** brands carry `urn:tag:genre:brand:sports_organization:soccer`, so clubs are likely `urn:entity:brand` (UNCERTAIN that
  SSC Napoli specifically exists).
- There is no "sport" or "event" type. Moments like the 1970 World Cup are LLM-only.
- `album` is search-only and cannot be an insights target. Songs do not exist at all.
- `take` is at most 50 per call. Use `page` for more.

**(c) Images and metadata: SUPPORTED.** Use `results.entities[].properties.image.url` (insights), plus `filter.exists=properties.image`
to get only entities with images (UNCERTAIN per type). For `/search` and `/entities` the image path is expected to match (UNCERTAIN).
Descriptions are `properties.description` and `properties.short_descriptions[]` (multilingual `{value, languages}`), so pick `en` or `it`.
Tags are in `tags[]`. Cache responses server-side. Never call Qloo from the browser (keep the key server-side). The kit's
SAFE_USE says not to send personal data, so send only cultural seeds (entity IDs, a city name, an age bucket), never the person's name.
It also says to present results as aggregate affinities, not as claims about the individual.

---

## 7. UNCERTAIN: validate once a key arrives
1. Which base URL the issued key works on: `hackathon.api.qloo.com` (docs) or `api.qloo.com` (kit harness default). Expect a 401 on the wrong one.
2. The exact `/search` and `/entities` item shape: `entity_id` vs `id`, `subtype` vs `types[]`, presence of `properties.image.url`,
   `popularity`, `properties.release_year`, and whether `results` is an array or `results.entities`.
3. `urn:entity:videogame` vs `urn:entity:video_game`. Whether `urn:entity:destination` works in insights.
4. Whether `signal.location` / `signal.location.query` actually change rankings for artist, movie, tv_show, book and person.
5. Whether `filter.release_date.*` and `filter.exists` work, and for which types. Whether `filter.release_country` takes `Italy` or `IT`.
6. The raw property paths for artist and person `date_of_birth`, book `publication_year`, brand `founded_year`, and `short_description`.
7. Whether `query.affinity` is always present when a signal is given. Its range (0–1 in the examples).
8. Whether decade music tags exist beyond `60s`/`eighties` (`50s`? `70s`?). Use `/v2/tags?filter.query=50s&filter.tag.types=urn:tag:genre:music`.
9. Coverage of Italian or 1950s–60s entities (Totò, Mina, Domenico Modugno, SSC Napoli, Sivori) in hackathon data.
10. Whether `/v2/tags` accepts `filter.parents.types=urn:entity:artist` (the enum lists only `urn:audience:*`).
11. The default `take` for `/search`. Actual rate limit and quota numbers. `Retry-After` on 429.
12. Whether the `/search` `types` param accepts multiple comma-separated values (the OpenAPI example implies yes).
