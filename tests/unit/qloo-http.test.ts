import { describe, expect, it } from "vitest";

import { MemoryCache } from "@/lib/adapters/cache";
import { QlooHttp, retryAfterMs } from "@/lib/adapters/qloo/http";
import { extractEntities, extractTags } from "@/lib/adapters/qloo/mapping";
import { insightsParams, toUrlSearchParams } from "@/lib/adapters/qloo/params";
import type { AppConfig } from "@/lib/config";

import insightsMovie from "./fixtures/qloo/insights-movie.json";
import searchArray from "./fixtures/qloo/search-array.json";
import searchEntities from "./fixtures/qloo/search-entities.json";
import tags from "./fixtures/qloo/tags.json";
import { recordingLogger, testCtx } from "./helpers";

const SECRET = "qloo-secret-key-123";
const config: AppConfig["qloo"] = {
  mode: "live",
  apiKey: SECRET,
  baseUrl: "https://hackathon.api.qloo.com",
  timeoutMs: 1_000,
  maxRetries: 2,
  defaultTake: 10,
  cacheTtlSeconds: 60,
};

interface Sent {
  url: URL;
  headers: Record<string, string>;
}

function fakeFetch(responses: Array<Response | Error>) {
  const sent: Sent[] = [];
  const fn = async (input: string, init: RequestInit) => {
    sent.push({ url: new URL(input), headers: init.headers as Record<string, string> });
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    if (next instanceof Error) throw next;
    return next;
  };
  return { fn, sent };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const noSleep = async () => {};

describe("Qloo response mapping", () => {
  it("maps /search results[] defensively and drops unknown types and missing ids", () => {
    const items = extractEntities(searchArray)!;
    expect(items.map((e) => e.name)).toEqual(["Frank Sinatra", "Frank Sinatra Jr."]);
    expect(items[0]).toMatchObject({
      qlooId: "00000000-0000-4000-8000-000000000001",
      type: "urn:entity:artist",
      dateOfBirth: "1915-12-12",
      popularity: 0.99,
      description: "American singer and actor",
      disambiguation: "American singer",
      imageUrl: expect.stringContaining("images.qloo.com"),
      tags: [{ id: "urn:tag:genre:music:jazz", name: "Jazz", type: "urn:tag:genre:music" }],
    });
  });

  it("maps results.entities[], id, subtype, release_date and English short descriptions", () => {
    const items = extractEntities(searchEntities)!;
    expect(items[0]).toMatchObject({
      qlooId: "00000000-0000-4000-8000-000000000010",
      type: "urn:entity:movie",
      releaseYear: 1960,
      popularity: 0.87,
      description: "1960 film by Federico Fellini",
    });
    expect(items[1].type).toBe("urn:entity:videogame");
  });

  it("maps insights affinity, release_year and drops out-of-range popularity", () => {
    const items = extractEntities(insightsMovie)!;
    expect(items[0]).toMatchObject({ releaseYear: 1964, affinity: 0.87, description: "A Naples love story." });
    expect(items[0].tags[0]).toEqual({ id: "urn:tag:genre:media:comedy", name: "Comedy", type: "urn:tag:genre:media" });
    expect(items[1].popularity).toBeUndefined();
  });

  it("maps tags with id or tag_id and drops non-tag ids", () => {
    expect(extractTags(tags)!.map((t) => t.id)).toEqual(["urn:tag:genre:music:60s", "urn:tag:genre:music:sixties_pop"]);
    expect(extractEntities("garbage")).toBeUndefined();
  });
});

describe("insights params", () => {
  it("sends only the era filter the type supports, defaults bias.trends to off and caps take", () => {
    const era = { releaseYear: { min: 1952, max: 1972 }, dateOfBirth: { min: "1900-01-01" } };
    const movie = insightsParams({ type: "urn:entity:movie", seedEntityIds: ["a", "b"], era, take: 99 as never }, 10);
    expect(movie).toMatchObject({
      "filter.type": "urn:entity:movie",
      "signal.interests.entities": ["a", "b"],
      "filter.release_year.min": 1952,
      "filter.release_year.max": 1972,
      "bias.trends": "off",
      take: 50,
    });
    expect(movie).not.toHaveProperty("filter.date_of_birth.min");
    const artist = insightsParams({ type: "urn:entity:artist", era, filterTagIds: ["urn:tag:genre:music:60s"], requireImage: true }, 10);
    expect(Object.keys(artist).some((k) => k.includes("year") || k.includes("birth"))).toBe(false);
    expect(artist).toMatchObject({ "filter.tags": ["urn:tag:genre:music:60s"], "filter.exists": "properties.image", take: 10 });
    const person = insightsParams({ type: "urn:entity:person", era }, 10);
    expect(person["filter.date_of_birth.min"]).toBe("1900-01-01");
    const book = insightsParams({ type: "urn:entity:book", era: { publicationYear: { max: 1970 } } }, 10);
    expect(book["filter.publication_year.max"]).toBe(1970);
    expect(toUrlSearchParams(movie).get("signal.interests.entities")).toBe("a,b");
    const decades = insightsParams({ type: "urn:entity:artist", seedTagIds: ["urn:tag:genre:music:50s", "urn:tag:genre:music:60s"] }, 10);
    expect(decades["operator.signal.interests.tags"]).toBe("union");
    expect(toUrlSearchParams(decades).get("signal.interests.tags")).toBe("urn:tag:genre:music:50s,urn:tag:genre:music:60s");
    const single = insightsParams({ type: "urn:entity:artist", seedTagIds: ["urn:tag:genre:music:60s"] }, 10);
    expect(single).not.toHaveProperty("operator.signal.interests.tags");
  });
});

describe("QlooHttp", () => {
  it("rejects queries with unknown keys before any request (strict port schemas)", async () => {
    const { fn, sent } = fakeFetch([]);
    const qloo = new QlooHttp(config, new MemoryCache(), { fetch: fn, sleep: noSleep });
    const bad = { query: "Frank Sinatra", types: ["urn:entity:artist"], personName: "Maria" } as never;
    await expect(qloo.search(bad, testCtx())).rejects.toThrow();
    expect(sent).toHaveLength(0);
  });

  it("sends a GET with X-Api-Key and comma-joined arrays, returns a record without the key, and caches", async () => {
    const { fn, sent } = fakeFetch([json(searchArray)]);
    const { logger, lines } = recordingLogger();
    const qloo = new QlooHttp(config, new MemoryCache(), { fetch: fn, sleep: noSleep });
    const query = { query: "Frank Sinatra", types: ["urn:entity:artist" as const, "urn:entity:person" as const], take: 5 };
    const res = await qloo.search(query, testCtx({ logger }));
    expect(sent[0].url.pathname).toBe("/search");
    expect(sent[0].url.searchParams.get("types")).toBe("urn:entity:artist,urn:entity:person");
    expect(sent[0].url.searchParams.get("take")).toBe("5");
    expect(sent[0].headers["X-Api-Key"]).toBe(SECRET);
    expect(res.items).toHaveLength(2);
    expect(res.request).toMatchObject({ endpoint: "/search", resultCount: 2, cached: false, source: "live" });
    expect(res.request.params).toEqual({ query: "Frank Sinatra", types: ["urn:entity:artist", "urn:entity:person"], take: 5 });
    expect(JSON.stringify(res.request)).not.toContain(SECRET);

    const again = await qloo.search(query, testCtx({ logger }));
    expect(again.request.cached).toBe(true);
    expect(sent).toHaveLength(1);
    expect(lines.join("")).not.toContain(SECRET);
    expect(lines.join("")).not.toContain("Frank Sinatra");
  });

  it("retries 429 and 5xx honouring Retry-After, bounded by maxRetries", async () => {
    const waits: number[] = [];
    const sleep = async (ms: number) => void waits.push(ms);
    const { fn, sent } = fakeFetch([json({}, 429, { "retry-after": "1" }), json({}, 503), json(tags)]);
    const qloo = new QlooHttp(config, new MemoryCache(), { fetch: fn, sleep });
    const res = await qloo.searchTags({ query: "60s", tagTypes: ["urn:tag:genre:music"] }, testCtx());
    expect(sent).toHaveLength(3);
    expect(waits[0]).toBe(1000);
    expect(res.items).toHaveLength(2);
    expect(sent[2].url.searchParams.get("filter.query")).toBe("60s");

    const exhausted = fakeFetch([json({}, 500), json({}, 500), json({}, 500)]);
    const failing = new QlooHttp(config, new MemoryCache(), { fetch: exhausted.fn, sleep: noSleep });
    await expect(failing.getEntities({ qlooIds: ["x"] }, testCtx())).rejects.toMatchObject({ port: "taste", code: "unavailable" });
    expect(exhausted.sent).toHaveLength(3);
  });

  it("does not retry 401 and maps it to unauthorized without leaking the key", async () => {
    const { fn, sent } = fakeFetch([json({ message: "No API key found in request" }, 401)]);
    const qloo = new QlooHttp(config, new MemoryCache(), { fetch: fn, sleep: noSleep });
    const error = await qloo.insights({ type: "urn:entity:movie" }, testCtx()).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "unauthorized", retryable: false });
    expect(String((error as Error).message)).not.toContain(SECRET);
    expect(sent).toHaveLength(1);
  });

  it("retries once without signal.location.query on a 400", async () => {
    const { fn, sent } = fakeFetch([json({ code: 400 }, 400), json(insightsMovie)]);
    const qloo = new QlooHttp(config, new MemoryCache(), { fetch: fn, sleep: noSleep });
    const res = await qloo.insights({ type: "urn:entity:movie", locationQuery: "Atlantis", seedEntityIds: ["s"] }, testCtx());
    expect(sent[0].url.searchParams.get("signal.location.query")).toBe("Atlantis");
    expect(sent[1].url.searchParams.has("signal.location.query")).toBe(false);
    expect(res.request.params).not.toHaveProperty("signal.location.query");
    expect(res.items[0].affinity).toBe(0.87);
  });

  it("maps network failures and timeouts, and fails on a bad body", async () => {
    const network = fakeFetch([new TypeError("fetch failed"), new TypeError("fetch failed"), new TypeError("fetch failed")]);
    const a = new QlooHttp(config, new MemoryCache(), { fetch: network.fn, sleep: noSleep });
    await expect(a.search({ query: "x", types: ["urn:entity:movie"] }, testCtx())).rejects.toMatchObject({ code: "unavailable" });

    const controller = new AbortController();
    controller.abort();
    const b = new QlooHttp(config, new MemoryCache(), { fetch: fakeFetch([]).fn, sleep: noSleep });
    await expect(b.search({ query: "x", types: ["urn:entity:movie"] }, testCtx({ signal: controller.signal }))).rejects.toMatchObject({ code: "timeout" });

    const garbage = fakeFetch([new Response("not json", { status: 200 })]);
    const c = new QlooHttp(config, new MemoryCache(), { fetch: garbage.fn, sleep: noSleep });
    await expect(c.search({ query: "x", types: ["urn:entity:movie"] }, testCtx())).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("parses Retry-After seconds and dates with a cap", () => {
    expect(retryAfterMs(null)).toBeUndefined();
    expect(retryAfterMs("2")).toBe(2000);
    expect(retryAfterMs("600")).toBe(4000);
    expect(retryAfterMs(new Date(10_000).toUTCString(), 9_000)).toBe(1000);
    expect(retryAfterMs("soon")).toBeUndefined();
  });
});
