/**
 * Phase 2 persona × domain coverage probe. Exercises the real QlooHttp adapter
 * (going through TastePort.search / insights / searchTags) for the three
 * built-in personas (Maria, Seamus, Fatima), covering the TasteDomain anchors
 * most relevant to each.
 *
 * Developer-only, never imported by the app.
 *
 *   QLOO_API_KEY=... npx vitest run --config scripts/vitest.probe.config.mts \
 *     scripts/qloo-coverage.probe.ts
 */
import pino from "pino";
import { it } from "vitest";

import { MemoryCache } from "@/lib/adapters/cache";
import { QlooHttp } from "@/lib/adapters/qloo/http";
import { loadConfig } from "@/lib/config";
import type { QlooEntityType, QlooInsightsType } from "@/lib/domain/types";
import { personalTermsFromDisplayName, withPersonalDataGuard } from "@/lib/ports";
import type { TasteEntity } from "@/lib/ports";

const logger = pino({ level: "silent" });
const ctx = { traceId: "coverage", logger };

interface Cell {
  domain: string;
  verdict: "ok" | "partial" | "empty" | "error";
  count: number;
  sample: string[];
  note?: string;
}

async function safe<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; err: string }> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    return { ok: false, err: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
  }
}

function sampleNames(items: TasteEntity[], n = 3): string[] {
  return items.slice(0, n).map((e) => (e.releaseYear ? `${e.name} (${e.releaseYear})` : e.name));
}

function conforms(items: TasteEntity[], minYear: number, maxYear: number): number {
  return items.filter((e) => e.releaseYear !== undefined && e.releaseYear >= minYear && e.releaseYear <= maxYear).length;
}

it("qloo persona coverage", { timeout: 300_000 }, async () => {
  const config = loadConfig(process.env);
  if (config.qloo.mode !== "live" || !config.qloo.apiKey) {
    process.stdout.write("QLOO_API_KEY is not set: skipping.\n");
    return;
  }
  const port = withPersonalDataGuard(new QlooHttp(config.qloo, new MemoryCache()), personalTermsFromDisplayName("probe"));

  const seed = async (name: string, types: QlooEntityType[]): Promise<TasteEntity | undefined> => {
    const r = await port.search({ query: name, types, take: 3 }, ctx);
    return r.items[0];
  };

  const report: Record<string, Record<string, Cell>> = {};

  // ---------------- MARIA (Naples, 1942, formative ~1952-1972) ----------------
  {
    const slug = "maria";
    const cells: Record<string, Cell> = {};
    const t0 = Date.now();

    // Music: era tags + insights for artist with 50s/60s tags; also seed artist Renato Carosone -> affinity.
    {
      const tags = await port.searchTags({ query: "50s", tagTypes: ["urn:tag:genre:music"], take: 5 }, ctx);
      const tag50s = tags.items.map((t) => t.id)[0];
      const r = await safe(() =>
        port.insights(
          {
            type: "urn:entity:artist" as QlooInsightsType,
            filterTagIds: tag50s ? [tag50s] : undefined,
            locationQuery: "Naples",
            take: 10,
          },
          ctx,
        ),
      );
      if (!r.ok) cells.music = { domain: "music", verdict: "error", count: 0, sample: [], note: r.err };
      else {
        const n = r.value.items.length;
        cells.music = {
          domain: "music",
          verdict: n >= 5 ? "ok" : n > 0 ? "partial" : "empty",
          count: n,
          sample: sampleNames(r.value.items),
        };
      }
    }

    // Food: insights for place in Naples
    {
      const r = await safe(() =>
        port.insights({ type: "urn:entity:place" as QlooInsightsType, locationQuery: "Naples", take: 10 }, ctx),
      );
      if (!r.ok) cells.food = { domain: "food", verdict: "error", count: 0, sample: [], note: r.err };
      else {
        const n = r.value.items.length;
        cells.food = {
          domain: "food",
          verdict: n >= 5 ? "ok" : n > 0 ? "partial" : "empty",
          count: n,
          sample: sampleNames(r.value.items),
        };
      }
    }

    // Place: destination for Naples
    {
      const r = await safe(() => port.search({ query: "Naples", types: ["urn:entity:destination"], take: 5 }, ctx));
      if (!r.ok) cells.place = { domain: "place", verdict: "error", count: 0, sample: [], note: r.err };
      else {
        const n = r.value.items.length;
        cells.place = {
          domain: "place",
          verdict: n > 0 ? "ok" : "empty",
          count: n,
          sample: sampleNames(r.value.items),
        };
      }
    }

    // TV/Movie: era filter releaseYear 1952-1972 via Sinatra seed
    {
      const sin = await seed("Frank Sinatra", ["urn:entity:artist"]);
      const r = await safe(() =>
        port.insights(
          {
            type: "urn:entity:movie" as QlooInsightsType,
            seedEntityIds: sin ? [sin.qlooId] : undefined,
            era: { releaseYear: { min: 1952, max: 1972 } },
            take: 10,
          },
          ctx,
        ),
      );
      if (!r.ok) cells.movie = { domain: "movie", verdict: "error", count: 0, sample: [], note: r.err };
      else {
        const items = r.value.items;
        const inWindow = conforms(items, 1952, 1972);
        cells.movie = {
          domain: "movie",
          verdict: items.length === 0 ? "empty" : inWindow >= Math.max(1, items.length - 1) ? "ok" : "partial",
          count: items.length,
          sample: sampleNames(items),
          note: `${inWindow}/${items.length} in 1952-1972`,
        };
      }
    }

    // Person: era filter dateOfBirth seeded by Sinatra
    {
      const sin = await seed("Frank Sinatra", ["urn:entity:artist"]);
      const r = await safe(() =>
        port.insights(
          {
            type: "urn:entity:person" as QlooInsightsType,
            seedEntityIds: sin ? [sin.qlooId] : undefined,
            era: { dateOfBirth: { min: "1900-01-01", max: "1950-12-31" } },
            take: 10,
          },
          ctx,
        ),
      );
      if (!r.ok) cells.person = { domain: "person", verdict: "error", count: 0, sample: [], note: r.err };
      else {
        const items = r.value.items;
        cells.person = {
          domain: "person",
          verdict: items.length >= 5 ? "ok" : items.length > 0 ? "partial" : "empty",
          count: items.length,
          sample: items.slice(0, 3).map((e) => `${e.name} (${e.dateOfBirth ?? "?"})`),
        };
      }
    }

    report[slug] = cells;
    process.stdout.write(`\n--- maria done in ${Date.now() - t0}ms ---\n${JSON.stringify(cells, null, 2)}\n`);
  }

  // ---------------- SEAMUS (Cork, 1938, formative ~1948-1968) ----------------
  {
    const slug = "seamus";
    const cells: Record<string, Cell> = {};
    const t0 = Date.now();

    // Music: artist with 50s/60s tag, location Cork
    {
      const tags = await port.searchTags({ query: "60s", tagTypes: ["urn:tag:genre:music"], take: 3 }, ctx);
      const tagId = tags.items.map((t) => t.id)[0];
      const r = await safe(() =>
        port.insights(
          {
            type: "urn:entity:artist" as QlooInsightsType,
            filterTagIds: tagId ? [tagId] : undefined,
            locationQuery: "Cork",
            take: 10,
          },
          ctx,
        ),
      );
      if (!r.ok) cells.music = { domain: "music", verdict: "error", count: 0, sample: [], note: r.err };
      else {
        const n = r.value.items.length;
        cells.music = { domain: "music", verdict: n >= 5 ? "ok" : n > 0 ? "partial" : "empty", count: n, sample: sampleNames(r.value.items) };
      }
    }

    // Book: era 1945-1975 via John Wayne seed
    {
      const seedE = await seed("John Wayne", ["urn:entity:person"]);
      const r = await safe(() =>
        port.insights(
          {
            type: "urn:entity:book" as QlooInsightsType,
            seedEntityIds: seedE ? [seedE.qlooId] : undefined,
            era: { publicationYear: { min: 1945, max: 1975 } },
            take: 10,
          },
          ctx,
        ),
      );
      if (!r.ok) cells.book = { domain: "book", verdict: "error", count: 0, sample: [], note: r.err };
      else {
        const n = r.value.items.length;
        cells.book = { domain: "book", verdict: n >= 5 ? "ok" : n > 0 ? "partial" : "empty", count: n, sample: sampleNames(r.value.items) };
      }
    }

    // Place: destination Cork / Ireland
    {
      const r1 = await safe(() => port.search({ query: "Cork", types: ["urn:entity:destination"], take: 5 }, ctx));
      const r2 = await safe(() => port.search({ query: "Ireland", types: ["urn:entity:destination"], take: 5 }, ctx));
      const n = (r1.ok ? r1.value.items.length : 0) + (r2.ok ? r2.value.items.length : 0);
      const names = [
        ...(r1.ok ? sampleNames(r1.value.items, 2) : []),
        ...(r2.ok ? sampleNames(r2.value.items, 2) : []),
      ];
      cells.place = {
        domain: "place",
        verdict: n > 0 ? "ok" : "empty",
        count: n,
        sample: names,
        note: `Cork=${r1.ok ? r1.value.items.length : "err"} Ireland=${r2.ok ? r2.value.items.length : "err"}`,
      };
    }

    // Movie / TV: westerns era 1948-1968
    {
      const seedE = await seed("John Wayne", ["urn:entity:person"]);
      const r = await safe(() =>
        port.insights(
          {
            type: "urn:entity:movie" as QlooInsightsType,
            seedEntityIds: seedE ? [seedE.qlooId] : undefined,
            era: { releaseYear: { min: 1948, max: 1968 } },
            take: 10,
          },
          ctx,
        ),
      );
      if (!r.ok) cells.movie = { domain: "movie", verdict: "error", count: 0, sample: [], note: r.err };
      else {
        const items = r.value.items;
        const inWindow = conforms(items, 1948, 1968);
        cells.movie = {
          domain: "movie",
          verdict: items.length === 0 ? "empty" : inWindow >= Math.max(1, items.length - 1) ? "ok" : "partial",
          count: items.length,
          sample: sampleNames(items),
          note: `${inWindow}/${items.length} in 1948-1968`,
        };
      }
    }

    // Person: 1900-1945 births, seeded by John Wayne
    {
      const seedE = await seed("John Wayne", ["urn:entity:person"]);
      const r = await safe(() =>
        port.insights(
          {
            type: "urn:entity:person" as QlooInsightsType,
            seedEntityIds: seedE ? [seedE.qlooId] : undefined,
            era: { dateOfBirth: { min: "1900-01-01", max: "1945-12-31" } },
            take: 10,
          },
          ctx,
        ),
      );
      if (!r.ok) cells.person = { domain: "person", verdict: "error", count: 0, sample: [], note: r.err };
      else {
        const items = r.value.items;
        cells.person = {
          domain: "person",
          verdict: items.length >= 5 ? "ok" : items.length > 0 ? "partial" : "empty",
          count: items.length,
          sample: items.slice(0, 3).map((e) => `${e.name} (${e.dateOfBirth ?? "?"})`),
        };
      }
    }

    report[slug] = cells;
    process.stdout.write(`\n--- seamus done in ${Date.now() - t0}ms ---\n${JSON.stringify(cells, null, 2)}\n`);
  }

  // ---------------- FATIMA (Fès, 1950, Brussels since 1972) ----------------
  {
    const slug = "fatima";
    const cells: Record<string, Cell> = {};
    const t0 = Date.now();

    // Music: Oum Kalthoum seed, insights for artist
    {
      const seedE = await seed("Oum Kalthoum", ["urn:entity:artist"]);
      const r = await safe(() =>
        port.insights(
          {
            type: "urn:entity:artist" as QlooInsightsType,
            seedEntityIds: seedE ? [seedE.qlooId] : undefined,
            take: 10,
          },
          ctx,
        ),
      );
      if (!r.ok) cells.music = { domain: "music", verdict: "error", count: 0, sample: [], note: r.err };
      else {
        const n = r.value.items.length;
        cells.music = { domain: "music", verdict: n >= 5 ? "ok" : n > 0 ? "partial" : "empty", count: n, sample: sampleNames(r.value.items) };
      }
    }

    // Food: Moroccan & Belgian - try destinations/places by location
    {
      const r1 = await safe(() =>
        port.insights({ type: "urn:entity:place" as QlooInsightsType, locationQuery: "Fes", take: 5 }, ctx),
      );
      const r2 = await safe(() =>
        port.insights({ type: "urn:entity:place" as QlooInsightsType, locationQuery: "Brussels", take: 5 }, ctx),
      );
      const n = (r1.ok ? r1.value.items.length : 0) + (r2.ok ? r2.value.items.length : 0);
      cells.food = {
        domain: "food",
        verdict: n > 0 ? "ok" : "empty",
        count: n,
        sample: [
          ...(r1.ok ? sampleNames(r1.value.items, 2) : []),
          ...(r2.ok ? sampleNames(r2.value.items, 2) : []),
        ],
        note: `Fes=${r1.ok ? r1.value.items.length : "err"} Brussels=${r2.ok ? r2.value.items.length : "err"}`,
      };
    }

    // Place: Fès and Brussels destinations
    {
      const r1 = await safe(() => port.search({ query: "Fes", types: ["urn:entity:destination"], take: 3 }, ctx));
      const r2 = await safe(() => port.search({ query: "Brussels", types: ["urn:entity:destination"], take: 3 }, ctx));
      const n = (r1.ok ? r1.value.items.length : 0) + (r2.ok ? r2.value.items.length : 0);
      cells.place = {
        domain: "place",
        verdict: n > 0 ? "ok" : "empty",
        count: n,
        sample: [
          ...(r1.ok ? sampleNames(r1.value.items, 1) : []),
          ...(r2.ok ? sampleNames(r2.value.items, 1) : []),
        ],
        note: `Fes=${r1.ok ? r1.value.items.length : "err"} Brussels=${r2.ok ? r2.value.items.length : "err"}`,
      };
    }

    // Movie: Egyptian b/w films era, seeded by Faten Hamama
    {
      const seedE = await seed("Faten Hamama", ["urn:entity:person"]);
      const r = await safe(() =>
        port.insights(
          {
            type: "urn:entity:movie" as QlooInsightsType,
            seedEntityIds: seedE ? [seedE.qlooId] : undefined,
            era: { releaseYear: { min: 1955, max: 1975 } },
            take: 10,
          },
          ctx,
        ),
      );
      if (!r.ok) cells.movie = { domain: "movie", verdict: "error", count: 0, sample: [], note: r.err };
      else {
        const items = r.value.items;
        const inWindow = conforms(items, 1955, 1975);
        cells.movie = {
          domain: "movie",
          verdict: items.length === 0 ? "empty" : inWindow >= Math.max(1, items.length - 1) ? "ok" : "partial",
          count: items.length,
          sample: sampleNames(items),
          note: `${inWindow}/${items.length} in 1955-1975`,
        };
      }
    }

    // Person: 1900-1960 births around Faten Hamama
    {
      const seedE = await seed("Faten Hamama", ["urn:entity:person"]);
      const r = await safe(() =>
        port.insights(
          {
            type: "urn:entity:person" as QlooInsightsType,
            seedEntityIds: seedE ? [seedE.qlooId] : undefined,
            era: { dateOfBirth: { min: "1900-01-01", max: "1960-12-31" } },
            take: 10,
          },
          ctx,
        ),
      );
      if (!r.ok) cells.person = { domain: "person", verdict: "error", count: 0, sample: [], note: r.err };
      else {
        const items = r.value.items;
        cells.person = {
          domain: "person",
          verdict: items.length >= 5 ? "ok" : items.length > 0 ? "partial" : "empty",
          count: items.length,
          sample: items.slice(0, 3).map((e) => `${e.name} (${e.dateOfBirth ?? "?"})`),
        };
      }
    }

    report[slug] = cells;
    process.stdout.write(`\n--- fatima done in ${Date.now() - t0}ms ---\n${JSON.stringify(cells, null, 2)}\n`);
  }

  process.stdout.write(`\n===== COVERAGE SUMMARY =====\n${JSON.stringify(report, null, 2)}\n`);
});
