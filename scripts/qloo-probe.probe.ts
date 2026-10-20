/**
 * Developer-only live probe and parity check for the Qloo adapter (TODO C3.4).
 * Never imported by the app. Needs QLOO_API_KEY in the environment (export it
 * in your shell; this script does not read .env files).
 *
 *   QLOO_API_KEY=... npx vitest run --config scripts/vitest.probe.config.mts
 *
 * Optional parity with the official harness (docs/qloo-api.md section 8): install
 * `@qloo/qloo-harness` globally and set QLOO_BASE_URL and QLOO_TRUSTED_BASE_URL to
 * https://hackathon.api.qloo.com. Raw responses are written ONLY to the
 * git-ignored `.qloo-recordings/` folder (HARD RULE 5: never commit live data).
 *
 * What it reports (docs/qloo-api.md section 7, UNCERTAIN items):
 *  2. /search item shape (results[] vs results.entities[], entity_id vs id, subtype vs types[], image, year)
 *  3. urn:entity:videogame vs urn:entity:video_game, and urn:entity:destination in insights
 *  4. whether signal.location.query changes rankings (with/without diff)
 *  6/7. raw property paths (date_of_birth, publication_year, short_description) and query.affinity presence
 *  8. decade music tags (40s..80s)
 *  9. coverage of the persona candidates (verified through QlooHttp)
 *  parity: ids resolved by `qloo exec describe|recommend|find_tags` vs QlooHttp
 */
import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

import pino from "pino";
import { it } from "vitest";

import { MemoryCache } from "@/lib/adapters/cache";
import { QlooHttp } from "@/lib/adapters/qloo/http";
import { normalizeName } from "@/lib/adapters/qloo/mock";
import { loadConfig } from "@/lib/config";

const OUT_DIR = join(process.cwd(), ".qloo-recordings");
const run = promisify(execFile);
const logger = pino({ level: "silent" });
const ctx = { traceId: "probe", logger };

type Report = Record<string, unknown>;

function record(name: string, body: unknown): void {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, `${name}.json`), JSON.stringify(body, null, 2));
}

it("qloo live probe", { timeout: 300_000 }, async () => {
  const config = loadConfig(process.env);
  if (config.qloo.mode !== "live" || !config.qloo.apiKey) {
    process.stdout.write("QLOO_API_KEY is not set: nothing to probe.\n");
    return;
  }
  const apiKey = config.qloo.apiKey;
  const base = config.qloo.baseUrl;
  let rawCount = 0;
  const raw = async (path: string, params: Record<string, string>) => {
    const url = `${base}${path}?${new URLSearchParams(params).toString()}`;
    const res = await fetch(url, { headers: { "X-Api-Key": apiKey } });
    const body = await res.json().catch(() => null);
    record(`raw-${String(++rawCount).padStart(3, "0")}-${path.replaceAll("/", "_")}`, { path, params, status: res.status, body });
    return { status: res.status, body: body as Record<string, unknown> | null };
  };
  const http = new QlooHttp(config.qloo, new MemoryCache());
  const report: Report = { baseUrl: base, at: new Date().toISOString() };

  // 2. Search item shape.
  const search = await raw("/search", { query: "Frank Sinatra", types: "urn:entity:artist", take: "3" });
  const results = search.body?.results;
  const first = (Array.isArray(results) ? results[0] : (results as { entities?: unknown[] } | undefined)?.entities?.[0]) as Record<string, unknown> | undefined;
  report.searchShape = {
    status: search.status,
    resultsIsArray: Array.isArray(results),
    itemKeys: first ? Object.keys(first).sort() : [],
    propertyKeys: first?.properties ? Object.keys(first.properties as object).sort() : [],
  };

  // 3. Type spellings.
  const types: Report = {};
  for (const type of ["urn:entity:videogame", "urn:entity:video_game", "urn:entity:destination"]) {
    const res = await raw("/v2/insights", { "filter.type": type, "signal.location.query": "Naples", take: "3" });
    types[type] = res.status;
  }
  report.types = types;

  // 4. Location effect, 6/7. property paths and affinity.
  const sinatra = (await http.search({ query: "Frank Sinatra", types: ["urn:entity:artist"], take: 3 }, ctx)).items[0];
  if (sinatra) {
    const withLoc = await http.insights({ type: "urn:entity:movie", seedEntityIds: [sinatra.qlooId], locationQuery: "Naples", take: 10 }, ctx);
    const noLoc = await http.insights({ type: "urn:entity:movie", seedEntityIds: [sinatra.qlooId], take: 10 }, ctx);
    const a = withLoc.items.map((e) => e.qlooId);
    const b = new Set(noLoc.items.map((e) => e.qlooId));
    report.locationEffect = { overlap: a.filter((id) => b.has(id)).length, of: a.length, sameOrder: a.join() === [...b].join() };
    report.affinityPresent = withLoc.items.every((e) => e.affinity !== undefined);
    report.releaseYearPresent = withLoc.items.filter((e) => e.releaseYear !== undefined).length;
    const person = await raw("/v2/insights", { "filter.type": "urn:entity:person", "signal.interests.entities": sinatra.qlooId, take: "3" });
    const book = await raw("/v2/insights", { "filter.type": "urn:entity:book", "signal.interests.entities": sinatra.qlooId, take: "3" });
    const keys = (r: typeof person) => {
      const entities = (r.body?.results as { entities?: Array<{ properties?: object }> } | undefined)?.entities ?? [];
      return entities[0]?.properties ? Object.keys(entities[0].properties).sort() : [];
    };
    report.propertyPaths = { person: keys(person), book: keys(book) };
  }

  // 8. Decade tags.
  const tags: Report = {};
  for (const q of ["40s", "50s", "60s", "70s", "80s"]) {
    const res = await http.searchTags({ query: q, tagTypes: ["urn:tag:genre:music"], take: 3 }, ctx);
    tags[q] = res.items.map((t) => t.id);
  }
  report.decadeTags = tags;

  // Section 9 (persona-candidate coverage) was removed with the persona
  // fixtures; see scripts/qloo-coverage.probe.ts for the equivalent live
  // coverage sweep driven by real Gemini-recorded traces instead.
  void normalizeName;

  // Parity with the official harness, when available.
  try {
    const exec = async (op: string, input: unknown) => {
      const { stdout } = await run("qloo", ["exec", op, "--input", JSON.stringify(input)], { timeout: 60_000, env: process.env });
      return JSON.parse(stdout) as { status: string; results?: Array<{ entity_id?: string; id?: string; name?: string }> };
    };
    const described = await exec("describe", { entity: "Frank Sinatra", type: "urn:entity:artist" });
    const recommended = await exec("recommend", { target_type: "urn:entity:movie", signals: ["Frank Sinatra"], limit: 10 });
    const harnessIds = new Set((recommended.results ?? []).map((r) => r.entity_id ?? r.id));
    const ours = sinatra ? (await http.insights({ type: "urn:entity:movie", seedEntityIds: [sinatra.qlooId], trendBias: "medium", take: 10 }, ctx)).items : [];
    report.parity = {
      describeSameId: (described.results?.[0]?.entity_id ?? described.results?.[0]?.id) === sinatra?.qlooId,
      recommendOverlap: ours.filter((e) => harnessIds.has(e.qlooId)).length,
      of: ours.length,
      findTags: (await exec("find_tags", { query: "60s", limit: 5 })).results?.length ?? 0,
    };
  } catch (error) {
    report.parity = { skipped: `qloo CLI unavailable or failed (${error instanceof Error ? error.name : "error"})` };
  }

  record(`probe-report-${Date.now()}`, report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
});
