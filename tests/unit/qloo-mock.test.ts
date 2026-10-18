import { describe, expect, it } from "vitest";

import { MOCK_CATALOG } from "@/lib/adapters/qloo/fixtures/catalog";
import { MockQloo, normalizeName } from "@/lib/adapters/qloo/mock";
import { SAMPLE_GROUNDED_EVENTS } from "@/lib/domain/sample-events";
import { QlooCallRecord } from "@/lib/domain/types";

import { testCtx } from "./helpers";

const qloo = new MockQloo({ defaultTake: 10 });
const ctx = testCtx();

describe("MockQloo", () => {
  it("contains every verified Maria entity from the sample events with the same ids", () => {
    const sampleIds = SAMPLE_GROUNDED_EVENTS.flatMap((e) => (e.type === "verified" ? [e.entity.qlooId] : []));
    const ids = new Set(MOCK_CATALOG.map((e) => e.qlooId));
    expect(sampleIds.length).toBeGreaterThan(5);
    for (const id of sampleIds) expect(ids).toContain(id);
    expect(new Set(MOCK_CATALOG.map((e) => e.qlooId)).size).toBe(MOCK_CATALOG.length);
  });

  it("search returns exact normalized matches first, within the requested types", async () => {
    const res = await qloo.search({ query: "omar sivori", types: ["urn:entity:person"], take: 5 }, ctx);
    expect(res.items[0].name).toBe("Omar Sívori");
    expect(QlooCallRecord.parse(res.request)).toMatchObject({ endpoint: "/search", source: "mock", resultCount: res.items.length });
    const none = await qloo.search({ query: "Festival di Napoli 1958", types: ["urn:entity:album"] }, ctx);
    expect(none.items).toEqual([]);
    const wrongType = await qloo.search({ query: "Frank Sinatra", types: ["urn:entity:movie"] }, ctx);
    expect(wrongType.items).toEqual([]);
  });

  it("search also returns near matches that need disambiguation", async () => {
    const res = await qloo.search({ query: "Abdel Halim Hafez", types: ["urn:entity:artist"] }, ctx);
    expect(res.items.map((e) => e.name)).toEqual(["Abdelhalim Hafez"]);
    expect(normalizeName(res.items[0].name)).not.toBe(normalizeName("Abdel Halim Hafez"));
  });

  it("insights respect type, era filters, exclusions and order by affinity", async () => {
    const res = await qloo.insights(
      {
        type: "urn:entity:movie",
        seedEntityIds: ["SAMPLE-MOVIE-ORO-DI-NAPOLI", "SAMPLE-PERSON-LOREN"],
        era: { releaseYear: { min: 1952, max: 1972 } },
        excludeEntityIds: ["SAMPLE-MOVIE-QUATTRO-GIORNATE"],
        take: 10,
      },
      ctx,
    );
    const names = res.items.map((e) => e.name);
    expect(names[0]).toBe("Matrimonio all'italiana");
    expect(names).not.toContain("L'oro di Napoli");
    expect(names).not.toContain("Le quattro giornate di Napoli");
    expect(names).not.toContain("Napoli milionaria"); // 1950, outside the window
    expect(res.items.every((e) => e.type === "urn:entity:movie" && e.affinity !== undefined)).toBe(true);
    expect(res.request.params).toMatchObject({ "filter.release_year.min": 1952, "bias.trends": "off" });

    const people = await qloo.insights(
      { type: "urn:entity:person", seedEntityIds: ["SAMPLE-PERSON-SIVORI"], era: { dateOfBirth: { max: "1957-12-31" } } },
      ctx,
    );
    expect(people.items.map((e) => e.name)).not.toContain("Diego Maradona");

    const again = await qloo.insights({ type: "urn:entity:movie", seedEntityIds: ["SAMPLE-MOVIE-ORO-DI-NAPOLI"] }, ctx);
    const twice = await qloo.insights({ type: "urn:entity:movie", seedEntityIds: ["SAMPLE-MOVIE-ORO-DI-NAPOLI"] }, ctx);
    expect(twice.items).toEqual(again.items);
  });

  it("insights with unknown seeds fall back to the generic catalog, and tag filters apply", async () => {
    const res = await qloo.insights({ type: "urn:entity:artist", seedEntityIds: ["UNKNOWN"], filterTagIds: ["urn:tag:genre:music:60s"] }, ctx);
    expect(res.items.map((e) => e.name)).toEqual(["The Beatles", "The Rolling Stones"]);
  });

  it("tags, lookup and strict query parsing", async () => {
    const tags = await qloo.searchTags({ query: "60s", tagTypes: ["urn:tag:genre:music"] }, ctx);
    expect(tags.items).toEqual([{ id: "urn:tag:genre:music:60s", name: "60s", type: "urn:tag:genre:music" }]);
    const lookup = await qloo.getEntities({ qlooIds: ["SAMPLE-ARTIST-MUROLO", "missing"] }, ctx);
    expect(lookup.items.map((e) => e.name)).toEqual(["Roberto Murolo"]);
    await expect(qloo.search({ query: "x", types: ["urn:entity:artist"], notes: "private" } as never, ctx)).rejects.toMatchObject({
      code: "bad_request",
    });
  });
});
