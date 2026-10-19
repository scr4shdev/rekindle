/**
 * Tests for the four cultural-grounding fixes (feat/qloo-grounding):
 *   F1 — adapter retries insights on empty when both location & tag filters set.
 *   F2 — critique rejects cross-cultural extrapolations for non-Western origin.
 *   F3 — food queries route through a cuisine-tag side-lookup, omit if none.
 *   F4 — Fès alias; no country fallback.
 */
import { describe, expect, it, vi } from "vitest";

import { MemoryCache } from "@/lib/adapters/cache";
import { MockLlm } from "@/lib/adapters/llm/mock";
import { QlooHttp } from "@/lib/adapters/qloo/http";
import { MockQloo } from "@/lib/adapters/qloo/mock";
import { runSession } from "@/lib/agent";
import { isNonWesternOrigin, normalizePlaceName, primaryPlace } from "@/lib/agent/util";
import type { AppConfig } from "@/lib/config";
import type { AgentEvent, AgentEventOf, Anchors } from "@/lib/domain/types";
import { SessionRequest } from "@/lib/domain/types";
import { PERSONAS } from "@/lib/personas";
import type { TasteEntity, TastePort, TasteResponse, TasteTag } from "@/lib/ports";

import { collect, mockDeps } from "./agent-deps";
import { recordingLogger, testCtx } from "./helpers";

const ofType = <K extends AgentEvent["type"]>(events: AgentEvent[], type: K) => events.filter((e): e is AgentEventOf<K> => e.type === type);

const qlooConfig: AppConfig["qloo"] = {
  mode: "live",
  apiKey: "k",
  baseUrl: "https://hackathon.api.qloo.com",
  timeoutMs: 1_000,
  maxRetries: 2,
  defaultTake: 10,
  cacheTtlSeconds: 60,
};

interface Sent {
  url: URL;
}

function fakeFetch(responses: Array<Response | Error>) {
  const sent: Sent[] = [];
  const fn = async (input: string) => {
    sent.push({ url: new URL(input) });
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    if (next instanceof Error) throw next;
    return next;
  };
  return { fn, sent };
}

const emptyInsights = () =>
  new Response(JSON.stringify({ results: { entities: [] } }), { status: 200, headers: { "content-type": "application/json" } });
const insightsWith = (entities: unknown[]) =>
  new Response(JSON.stringify({ results: { entities } }), { status: 200, headers: { "content-type": "application/json" } });

const noSleep = async () => {};

// ---------------------------------------------------------------------------
// F1
// ---------------------------------------------------------------------------

describe("F1: resilient insights on empty with both location + tag filter", () => {
  it("retries without the location signal when the first call returns zero", async () => {
    const entity = { entity_id: "a1", name: "Artist One", subtype: "urn:entity:artist" };
    const { fn, sent } = fakeFetch([emptyInsights(), insightsWith([entity])]);
    const { logger, lines } = recordingLogger();
    const qloo = new QlooHttp(qlooConfig, new MemoryCache(), { fetch: fn, sleep: noSleep });
    const res = await qloo.insights(
      { type: "urn:entity:artist", locationQuery: "Naples", filterTagIds: ["urn:tag:genre:music:50s"] },
      testCtx({ logger }),
    );
    expect(sent).toHaveLength(2);
    expect(sent[0].url.searchParams.get("signal.location.query")).toBe("Naples");
    expect(sent[1].url.searchParams.has("signal.location.query")).toBe(false);
    expect(sent[1].url.searchParams.get("filter.tags")).toBe("urn:tag:genre:music:50s");
    expect(res.items).toHaveLength(1);
    expect(res.items[0].name).toBe("Artist One");
    expect(lines.join("")).toContain("signal.location.query");
    expect(lines.join("")).toContain("insights returned 0");
  });

  it("retries without the tag filter when the second call is still empty", async () => {
    const entity = { entity_id: "a1", name: "Artist One", subtype: "urn:entity:artist" };
    const { fn, sent } = fakeFetch([emptyInsights(), emptyInsights(), insightsWith([entity])]);
    const qloo = new QlooHttp(qlooConfig, new MemoryCache(), { fetch: fn, sleep: noSleep });
    const res = await qloo.insights(
      { type: "urn:entity:artist", locationQuery: "Naples", filterTagIds: ["urn:tag:genre:music:50s"] },
      testCtx(),
    );
    expect(sent).toHaveLength(3);
    // Third attempt keeps the original location, drops the tag filter.
    expect(sent[2].url.searchParams.has("filter.tags")).toBe(false);
    expect(sent[2].url.searchParams.get("signal.location.query")).toBe("Naples");
    expect(res.items).toHaveLength(1);
  });

  it("returns an empty result when all three attempts are empty, and logs both drops", async () => {
    const { fn, sent } = fakeFetch([emptyInsights(), emptyInsights(), emptyInsights()]);
    const { logger, lines } = recordingLogger();
    const qloo = new QlooHttp(qlooConfig, new MemoryCache(), { fetch: fn, sleep: noSleep });
    const res = await qloo.insights(
      { type: "urn:entity:artist", locationQuery: "Naples", filterTagIds: ["urn:tag:genre:music:50s"] },
      testCtx({ logger }),
    );
    expect(sent).toHaveLength(3);
    expect(res.items).toHaveLength(0);
    const log = lines.join("");
    expect(log).toContain("signal.location.query");
    expect(log).toContain("filter.tags");
  });

  it("does not retry when the request has only a location (no tag filter)", async () => {
    const { fn, sent } = fakeFetch([emptyInsights()]);
    const qloo = new QlooHttp(qlooConfig, new MemoryCache(), { fetch: fn, sleep: noSleep });
    const res = await qloo.insights({ type: "urn:entity:artist", locationQuery: "Naples" }, testCtx());
    expect(sent).toHaveLength(1);
    expect(res.items).toHaveLength(0);
  });

  it("R5: logs one info line and keeps best-effort semantics when the attempt 2 retry comes back non-OK", async () => {
    // Each attempt in fetchWithRetry costs maxRetries + 1 attempts on a retryable
    // 5xx; the test config sets maxRetries=2, so attempt 2 burns 3 fetches.
    const fail500 = () => new Response("boom", { status: 500 });
    const { fn, sent } = fakeFetch([emptyInsights(), fail500(), fail500(), fail500()]);
    const { logger, lines } = recordingLogger();
    const qloo = new QlooHttp(qlooConfig, new MemoryCache(), { fetch: fn, sleep: noSleep });
    const res = await qloo.insights(
      { type: "urn:entity:artist", locationQuery: "Naples", filterTagIds: ["urn:tag:genre:music:50s"] },
      testCtx({ logger }),
    );
    // Best effort: no throw; the original empty result is returned.
    expect(res.items).toHaveLength(0);
    expect(sent.length).toBeGreaterThanOrEqual(2);
    const log = lines.join("");
    expect(log).toContain("attempt 2");
    expect(log).toContain("signal.location.query");
  });

  it("R3: does not shadow attempt 2's non-empty result with an empty attempt 3", async () => {
    // Attempt 1 empty -> attempt 2 (location dropped) empty -> attempt 3 (tag dropped) empty.
    // The second non-empty result must come from attempt 2's semantics; attempt 3's
    // empty response must not overwrite them (previous behavior wrote empty items).
    // Here we also assert the cache stores the attempt-2 params when attempt 2 wins.
    const entity = { entity_id: "a1", name: "Artist One", subtype: "urn:entity:artist" };
    const { fn, sent } = fakeFetch([emptyInsights(), insightsWith([entity])]);
    const cache = new MemoryCache();
    const qloo = new QlooHttp(qlooConfig, cache, { fetch: fn, sleep: noSleep });
    const res = await qloo.insights(
      { type: "urn:entity:artist", locationQuery: "Naples", filterTagIds: ["urn:tag:genre:music:50s"] },
      testCtx(),
    );
    expect(sent).toHaveLength(2);
    expect(res.items).toHaveLength(1);
    // The cached record uses attempt 2's params (no location, still has filter.tags).
    expect(res.request.params["filter.tags"]).toBeDefined();
    expect(res.request.params["signal.location.query"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// F2
// ---------------------------------------------------------------------------

describe("F2: cultural-mismatch gate for non-Western origin", () => {
  it("rejects a Qloo-affinity entity for a non-Western persona when the LLM flags it as cultural_mismatch", async () => {
    const fatima = PERSONAS.find((p) => p.slug === "fatima")!;
    const baseLlm = new MockLlm({ cacheTtlSeconds: 0 });
    // Wrap: cultural-check marks any entity with "trump" in its name as mismatch.
    const llm = {
      mode: baseLlm.mode,
      provider: baseLlm.provider,
      model: baseLlm.model,
      generateObject: async (request: Parameters<typeof baseLlm.generateObject>[0], ctx: Parameters<typeof baseLlm.generateObject>[1]) => {
        if (request.promptId === "cultural-check") {
          const input = request.input as { items: Array<{ ref: string; name: string }> };
          const verdicts = input.items.map((item) => ({
            ref: item.ref,
            verdict: item.name.toLowerCase().includes("trump") ? ("cultural_mismatch" as const) : ("cultural_match" as const),
            reason: item.name.toLowerCase().includes("trump")
              ? "US public figure, far from a Fès-born Arabic-speaker's circle."
              : "Belongs to the person's culture.",
          }));
          return { object: { verdicts } as never, cached: false, provider: "mock", model: "mock-llm", latencyMs: 0 };
        }
        return baseLlm.generateObject(request, ctx);
      },
    };

    const baseQloo = new MockQloo({ defaultTake: 10 });
    const taste: TastePort = {
      mode: "mock",
      search: (q, c) => baseQloo.search(q, c),
      getEntities: (q, c) => baseQloo.getEntities(q, c),
      searchTags: (q, c) => baseQloo.searchTags(q, c),
      insights: async (q, c) => {
        const res = await baseQloo.insights(q, c);
        if (q.type === "urn:entity:person" && (q.seedEntityIds?.length ?? 0) > 0) {
          const bogus: TasteEntity = {
            qlooId: "person-donald-trump",
            name: "Donald Trump",
            type: "urn:entity:person",
            affinity: 0.95,
            popularity: 0.9,
            tags: [],
          };
          return { ...res, items: [bogus, ...res.items] };
        }
        return res;
      },
    };

    const deps = mockDeps({ taste, llm: llm as never });
    const events = await collect(runSession(deps, SessionRequest.parse({ person: fatima.input }), testCtx()));
    const rejected = ofType(events, "rejected").map((e) => e.item);
    const culturalReject = rejected.find((r) => r.reason.includes("cultural_mismatch"));
    expect(culturalReject).toBeDefined();
    expect(culturalReject!.label).toBe("Donald Trump");
    expect(culturalReject!.kind).toBe("wrong_locale");
    const plan = ofType(events, "plan")[0]!.plan;
    expect(plan.steps.flatMap((s) => (s.entity ? [s.entity.name] : []))).not.toContain("Donald Trump");
  });

  it("keeps a candidate flagged as unclear by the cultural check (not rejected)", async () => {
    const fatima = PERSONAS.find((p) => p.slug === "fatima")!;
    const baseLlm = new MockLlm({ cacheTtlSeconds: 0 });
    // Wrap: cultural-check marks any entity with "ambiguous" in its name as unclear
    // and everything else as cultural_match. Nothing should be rejected by the gate.
    const llm = {
      mode: baseLlm.mode,
      provider: baseLlm.provider,
      model: baseLlm.model,
      generateObject: async (request: Parameters<typeof baseLlm.generateObject>[0], ctx: Parameters<typeof baseLlm.generateObject>[1]) => {
        if (request.promptId === "cultural-check") {
          const input = request.input as { items: Array<{ ref: string; name: string }> };
          const verdicts = input.items.map((item) => ({
            ref: item.ref,
            verdict: item.name.toLowerCase().includes("ambiguous") ? ("unclear" as const) : ("cultural_match" as const),
            reason: item.name.toLowerCase().includes("ambiguous")
              ? "Could belong to this culture but the signal is weak."
              : "Belongs to the person's culture.",
          }));
          return { object: { verdicts } as never, cached: false, provider: "mock", model: "mock-llm", latencyMs: 0 };
        }
        return baseLlm.generateObject(request, ctx);
      },
    };

    const baseQloo = new MockQloo({ defaultTake: 10 });
    const taste: TastePort = {
      mode: "mock",
      search: (q, c) => baseQloo.search(q, c),
      getEntities: (q, c) => baseQloo.getEntities(q, c),
      searchTags: (q, c) => baseQloo.searchTags(q, c),
      insights: async (q, c) => {
        const res = await baseQloo.insights(q, c);
        if (q.type === "urn:entity:person" && (q.seedEntityIds?.length ?? 0) > 0) {
          const ambiguous: TasteEntity = {
            qlooId: "person-ambiguous-figure",
            name: "Ambiguous Figure",
            type: "urn:entity:person",
            affinity: 0.8,
            popularity: 0.6,
            tags: [],
          };
          return { ...res, items: [ambiguous, ...res.items] };
        }
        return res;
      },
    };

    const deps = mockDeps({ taste, llm: llm as never });
    const events = await collect(runSession(deps, SessionRequest.parse({ person: fatima.input }), testCtx()));
    const rejected = ofType(events, "rejected").map((e) => e.item);
    // The cultural gate must not reject an unclear verdict.
    expect(rejected.find((r) => r.label === "Ambiguous Figure" && r.reason.toLowerCase().startsWith("cultural_mismatch:"))).toBeUndefined();
  });

  it("skips the cultural gate for Western-origin personas (Seamus)", async () => {
    const seamus = PERSONAS.find((p) => p.slug === "seamus")!;
    const deps = mockDeps();
    const spy = vi.spyOn(deps.llm, "generateObject");
    await collect(runSession(deps, SessionRequest.parse({ person: seamus.input }), testCtx()));
    const culturalCalls = spy.mock.calls.filter(([req]) => (req as { promptId: string }).promptId === "cultural-check");
    expect(culturalCalls).toHaveLength(0);
  });

  it("isNonWesternOrigin classifies personas correctly", () => {
    const build = (country: string, lang: string): Anchors =>
      ({
        birthYear: 1950,
        birthYearSource: "stated",
        formativeWindow: { startYear: 1960, endYear: 1980 },
        places: [{ name: "x", countryCode: country, role: "birthplace" }],
        languages: [{ tag: lang, name: lang }],
        loves: [],
        sensitivities: [],
        summary: "x",
      }) as Anchors;
    expect(isNonWesternOrigin(build("MA", "fr"), "fr")).toBe(true); // non-Western country code
    expect(isNonWesternOrigin(build("IE", "en"), "en")).toBe(false);
    expect(isNonWesternOrigin(build("IT", "it"), "it")).toBe(false);
    expect(isNonWesternOrigin(build("IL", "he"), "he")).toBe(true); // non-Western lang
  });
});

// ---------------------------------------------------------------------------
// F3
// ---------------------------------------------------------------------------

describe("F3: cuisine-tag side-lookup for food candidates", () => {
  it("fires a /v2/tags call for cuisine when there are food candidates, and keeps food steps when a tag is found", async () => {
    const maria = PERSONAS.find((p) => p.slug === "maria")!;
    const events = await collect(runSession(mockDeps(), SessionRequest.parse({ person: maria.input }), testCtx()));
    const tagCalls = ofType(events, "qloo_call").filter(
      (e) => e.call.endpoint === "/v2/tags" && (e.call.params["filter.tag.types"] as string[] | undefined)?.includes("urn:tag:cuisine"),
    );
    expect(tagCalls.length).toBeGreaterThan(0);
    const plan = ofType(events, "plan")[0]!.plan;
    expect(plan.steps.some((s) => s.kind === "taste")).toBe(true);
  });

  it("drops food candidates (omits the food step) when no cuisine tag can be found", async () => {
    const maria = PERSONAS.find((p) => p.slug === "maria")!;
    const inner = new MockQloo({ defaultTake: 10 });
    // Replace searchTags: no cuisine tags ever come back.
    const taste: TastePort = {
      mode: "mock",
      search: (q, c) => inner.search(q, c),
      getEntities: (q, c) => inner.getEntities(q, c),
      insights: (q, c) => inner.insights(q, c),
      searchTags: async (q, c) => {
        if (q.tagTypes?.includes("urn:tag:cuisine")) {
          const res: TasteResponse<TasteTag> = {
            items: [],
            request: { endpoint: "/v2/tags", params: { "filter.query": q.query }, resultCount: 0, durationMs: 0, cached: false, source: "mock" },
          };
          return res;
        }
        return inner.searchTags(q, c);
      },
    };
    const events = await collect(runSession(mockDeps({ taste }), SessionRequest.parse({ person: maria.input }), testCtx()));
    const plan = ofType(events, "plan")[0]!.plan;
    // No taste step: the food item was dropped.
    expect(plan.steps.some((s) => s.kind === "taste")).toBe(false);
    const rejected = ofType(events, "rejected").map((e) => e.item);
    expect(rejected.some((r) => r.domain === "food" && r.phase === "verify")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// F4
// ---------------------------------------------------------------------------

describe("F4: Fès alias and no country fallback", () => {
  it("normalizePlaceName swaps 'Fes'/'Fez' to 'Fès' while preserving qualifiers", () => {
    expect(normalizePlaceName("Fes")).toBe("Fès");
    expect(normalizePlaceName("Fez")).toBe("Fès");
    expect(normalizePlaceName("Fes, Morocco")).toBe("Fès, Morocco");
    expect(normalizePlaceName("Naples")).toBe("Naples");
    expect(normalizePlaceName("Fès")).toBe("Fès");
  });

  it("primaryPlace uses the normalized city form that Qloo accepts", () => {
    const anchors = {
      birthYear: 1950,
      birthYearSource: "stated",
      formativeWindow: { startYear: 1960, endYear: 1980 },
      places: [{ name: "Fes, Morocco", countryCode: "MA", role: "birthplace" }],
      languages: [{ tag: "fr", name: "French" }],
      loves: [],
      sensitivities: [],
      summary: "x",
    } as Anchors;
    expect(primaryPlace(anchors)).toBe("Fès, Morocco");
  });

  it("adapter does not fall back to a country when a city is unrecognised (keeps the current drop-on-400 behavior)", async () => {
    // A 400 on the first attempt causes the adapter to drop signal.location.query (not swap to a country).
    const { fn, sent } = fakeFetch([
      new Response(JSON.stringify({ code: 400 }), { status: 400, headers: { "content-type": "application/json" } }),
      new Response(JSON.stringify({ results: { entities: [] } }), { status: 200, headers: { "content-type": "application/json" } }),
    ]);
    const qloo = new QlooHttp(qlooConfig, new MemoryCache(), { fetch: fn, sleep: noSleep });
    const res = await qloo.insights({ type: "urn:entity:artist", locationQuery: "Atlantis" }, testCtx());
    expect(sent).toHaveLength(2);
    expect(sent[0].url.searchParams.get("signal.location.query")).toBe("Atlantis");
    // Attempt 2 drops location without widening to any country.
    expect(sent[1].url.searchParams.has("signal.location.query")).toBe(false);
    expect(res.items).toHaveLength(0);
    // No further attempt (no "country" query ever formed).
    expect(sent).toHaveLength(2);
  });
});
