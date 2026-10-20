import { describe, expect, it } from "vitest";

import { MockLlm } from "@/lib/adapters/llm/mock";
import { MockQloo } from "@/lib/adapters/qloo/mock";
import { runSession } from "@/lib/agent";
import { toAnchors, toCandidates } from "@/lib/agent/phases/parse-propose";
import { createRun } from "@/lib/agent/run";
import { ageBucket, clip, eraFilter, isTasteOutage, mapLimit, normalizeDurations, normalizeName, primaryPlace } from "@/lib/agent/util";
import type { AgentEvent, AgentEventOf } from "@/lib/domain/types";
import { PersonInput, SessionRequest } from "@/lib/domain/types";
import { SAMPLE_ANCHORS } from "@/lib/domain/sample-events";
import { PERSONAS } from "@/lib/personas";
import type { LlmPort, TastePort } from "@/lib/ports";
import { PortError } from "@/lib/ports";

import { collect, mockDeps } from "./agent-deps";
import { testCtx } from "./helpers";
import { assertStreamRules } from "./stream-rules";

const ofType = <K extends AgentEvent["type"]>(list: AgentEvent[], type: K) => list.filter((e): e is AgentEventOf<K> => e.type === type);
const maria = PERSONAS.find((p) => p.slug === "maria")!;

describe("agent util", () => {
  it("clip, normalizeName and mapLimit", async () => {
    expect(clip("  ", 5)).toBeUndefined();
    expect(clip(undefined, 5)).toBeUndefined();
    expect(clip("abcdefgh", 5)).toBe("abcd…");
    expect(normalizeName("  Omar  SÍVORI ")).toBe("omar sivori");
    expect(normalizeName("L’oro di Napoli")).toBe("l'oro di napoli");
    let active = 0;
    let peak = 0;
    const results = await Promise.all(
      mapLimit([1, 2, 3, 4, 5], 2, async (n) => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 2));
        active--;
        return n * 2;
      }),
    );
    expect(results).toEqual([2, 4, 6, 8, 10]);
    expect(peak).toBe(2);
  });

  it("age buckets, era filters and the primary place", () => {
    expect([1940, 1975, 1985, 1994, 1999, 2005].map((y) => ageBucket(y, 2026))).toEqual([
      "55_and_older", "45_to_54", "35_to_44", "30_to_34", "25_to_29", "24_and_younger",
    ]);
    expect(eraFilter(SAMPLE_ANCHORS)).toEqual({
      releaseYear: { min: 1952, max: 1972 },
      publicationYear: { min: 1952, max: 1972 },
      dateOfBirth: { min: "1882-01-01", max: "1957-12-31" },
    });
    expect(primaryPlace(SAMPLE_ANCHORS)).toBe("Naples (Quartieri Spagnoli)");
    expect(primaryPlace({ ...SAMPLE_ANCHORS, places: [{ name: "Rome", role: "adulthood" }] })).toBe("Rome");
    expect(primaryPlace({ ...SAMPLE_ANCHORS, places: [] })).toBeUndefined();
  });

  it("normalizes durations to the session length within 1-30 minutes", () => {
    expect(normalizeDurations([], 20)).toEqual([]);
    expect(normalizeDurations([2, 3, 3, 3, 3, 3, 2, 1], 20).reduce((a, b) => a + b)).toBe(20);
    expect(normalizeDurations([1, 1, 1], 60)).toEqual([20, 20, 20]);
    expect(normalizeDurations([5, 5, 5, 5, 5, 5], 5)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(normalizeDurations([1], 60)).toEqual([30]);
    expect(normalizeDurations([0, Number.NaN, 4], 12).reduce((a, b) => a + b)).toBe(12);
  });

  it("only service-level taste errors are outages", () => {
    // Qloo-itself-unusable: full degrade to llm-only, surface the banner.
    expect(isTasteOutage(new PortError("taste", "unavailable", "u", true))).toBe(true);
    expect(isTasteOutage(new PortError("taste", "unauthorized", "u", false))).toBe(true);
    expect(isTasteOutage(new PortError("taste", "rate_limited", "r", true))).toBe(true);
    // Per-query misses: do not mark the run as Qloo-down.
    expect(isTasteOutage(new PortError("taste", "timeout", "t", true))).toBe(false);
    expect(isTasteOutage(new PortError("taste", "invalid_response", "i", false))).toBe(false);
    expect(isTasteOutage(new PortError("taste", "bad_request", "b", false))).toBe(false);
    expect(isTasteOutage(new PortError("llm", "unavailable", "u", true))).toBe(false);
    expect(isTasteOutage(new Error("x"))).toBe(false);
  });
});

describe("structured output mapping", () => {
  const run = createRun(mockDeps(), testCtx(), []);
  const person = PersonInput.parse({ notes: "Some notes long enough.", sessionLanguage: "it", birthPlace: "Bari" });

  it("toAnchors repairs invalid model values and applies the configured formative window", () => {
    const anchors = toAnchors(
      {
        birthYear: 3000,
        birthYearSource: "stated",
        places: [{ name: "  ", countryCode: "ITA", role: "other", fromYear: 0, toYear: 0 }],
        languages: [{ tag: "not a tag!", name: "x" }],
        loves: [{ label: "", domain: "music", source: "stated" }],
        sensitivities: [{ topic: "War", reason: "", severity: "avoid" }],
        occupation: "",
        culturalBackground: "",
        summary: "",
        privateNames: [],
        notes: [],
      },
      person,
      run,
    );
    expect(anchors.birthYear).toBe(1946);
    expect(anchors.birthYearSource).toBe("inferred");
    expect(anchors.formativeWindow).toEqual({ startYear: 1956, endYear: 1976 });
    expect(anchors.places).toEqual([{ name: "Bari", role: "birthplace", fromYear: 1946 }]);
    expect(anchors.languages).toEqual([{ tag: "it", name: "it" }]);
    expect(anchors.loves).toEqual([]);
    expect(anchors.sensitivities[0].reason).toBe("Noted by the caregiver.");
    expect(anchors.summary).toBe("Person born in 1946.");
    run.dispose();
  });

  it("toCandidates dedupes, caps per domain, fixes Qloo types and drops empty names", () => {
    const c = (name: string, domain: "music" | "food" | "film", qlooType: string, year = 0) => ({ domain, name, qlooType, year, rationale: "" }) as never;
    const out = toCandidates(
      {
        candidates: [
          c("Mina", "music", "urn:entity:artist", 1960),
          c("mina ", "music", "urn:entity:artist"),
          c("", "music", "urn:entity:artist"),
          c("Pizza", "food", "none"),
          c("Il sorpasso", "film", "urn:entity:artist", 1962),
        ],
        notes: [],
      },
      run,
    );
    expect(out.map((x) => [x.name, x.qlooType, x.year])).toEqual([
      ["Mina", "urn:entity:artist", 1960],
      ["Pizza", undefined, undefined],
      ["Il sorpasso", "urn:entity:movie", 1962],
    ]);
    expect(out[0].rationale).toBe("Fits the era and places in the notes.");
  });
});

describe("degraded paths", () => {
  it("a failing match-entity call is treated as not found, not as a fatal error", async () => {
    const mock = new MockLlm();
    const llm: LlmPort = {
      mode: "mock",
      provider: "mock",
      model: "mock-llm",
      generateObject: (req, ctx) => (req.promptId === "match-entity" ? Promise.reject(new PortError("llm", "unavailable", "x", true)) : mock.generateObject(req, ctx)),
    };
    const seamus = PERSONAS.find((p) => p.slug === "seamus")!;
    const events = await collect(runSession(mockDeps({ llm }), SessionRequest.parse({ person: seamus.input }), testCtx()));
    assertStreamRules(events, "session");
    expect(ofType(events, "rejected").find((e) => e.item.label === "Royal Showband")?.item.kind).toBe("not_found");
  });

  it("Qloo failing only during expand: recoverable error, verified items still used", async () => {
    const inner = new MockQloo({ defaultTake: 10 });
    const taste: TastePort = {
      mode: "mock",
      search: (q, c) => inner.search(q, c),
      getEntities: (q, c) => inner.getEntities(q, c),
      searchTags: (q, c) => inner.searchTags(q, c),
      insights: async () => {
        throw new PortError("taste", "rate_limited", "slow down", true);
      },
    };
    const events = await collect(runSession(mockDeps({ taste }), SessionRequest.parse({ person: maria.input }), testCtx()));
    assertStreamRules(events, "session");
    const errors = ofType(events, "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: "rate_limited", recoverable: true, phase: "expand" });
    const plan = ofType(events, "plan")[0].plan;
    expect(plan.steps.some((s) => s.provenance === "qloo-grounded")).toBe(true);
    expect(ofType(events, "verified").every((e) => e.entity.provenance === "llm-proposed-qloo-verified")).toBe(true);
  });

  it("a programming error inside a Qloo call is fatal, not a silent 'not found'", async () => {
    const inner = new MockQloo({ defaultTake: 10 });
    const taste: TastePort = {
      mode: "mock",
      search: async () => {
        throw new TypeError("bug");
      },
      getEntities: (q, c) => inner.getEntities(q, c),
      searchTags: (q, c) => inner.searchTags(q, c),
      insights: (q, c) => inner.insights(q, c),
    };
    const events = await collect(runSession(mockDeps({ taste }), SessionRequest.parse({ person: maria.input }), testCtx()));
    expect(ofType(events, "rejected")).toHaveLength(0);
    expect(ofType(events, "error")[0]).toMatchObject({ code: "internal", recoverable: false, phase: "verify" });
    expect(events.at(-1)!.type).toBe("done");
  });

  it("uses only decade tags whose id ends exactly with the decade", async () => {
    const inner = new MockQloo({ defaultTake: 10 });
    const taste: TastePort = {
      mode: "mock",
      search: (q, c) => inner.search(q, c),
      getEntities: (q, c) => inner.getEntities(q, c),
      insights: (q, c) => inner.insights(q, c),
      searchTags: async (q, c) => {
        const res = await inner.searchTags(q, c);
        return { ...res, items: [{ id: `urn:tag:genre:music:${q.query}_pop`, name: "Pop" }, ...res.items] };
      },
    };
    const events = await collect(runSession(mockDeps({ taste }), SessionRequest.parse({ person: maria.input }), testCtx()));
    const artist = ofType(events, "qloo_call").find((e) => e.call.params["filter.type"] === "urn:entity:artist")!;
    expect(artist.call.params["signal.interests.tags"]).toEqual(["urn:tag:genre:music:50s", "urn:tag:genre:music:60s", "urn:tag:genre:music:70s"]);
    const decadeCall = ofType(events, "qloo_call").find(
      (e) => e.call.endpoint === "/v2/tags" && (e.call.params["filter.tag.types"] as string[] | undefined)?.includes("urn:tag:genre:music"),
    )!;
    expect(decadeCall.call.params.take).toBe(3);
  });

  it("expansion turned off by config is reported as skipped", async () => {
    const events = await collect(runSession(mockDeps({}, { MAX_EXPANSIONS_PER_DOMAIN: "0" }), SessionRequest.parse({ person: maria.input }), testCtx()));
    assertStreamRules(events, "session");
    expect(ofType(events, "phase").find((e) => e.phase === "expand")).toMatchObject({ status: "skipped" });
  });

  it("an unexpected error becomes a fatal internal error with a safe message", async () => {
    const llm: LlmPort = {
      mode: "mock",
      provider: "mock",
      model: "mock-llm",
      generateObject: async () => {
        throw new TypeError("boom: private details");
      },
    };
    const events = await collect(runSession(mockDeps({ llm }), SessionRequest.parse({ person: maria.input }), testCtx()));
    const error = ofType(events, "error")[0];
    expect(error).toMatchObject({ code: "internal", recoverable: false });
    expect(error.message).not.toContain("private");
  });
});
