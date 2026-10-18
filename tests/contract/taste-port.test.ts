import pino from "pino";
import { describe, expect, it } from "vitest";

import { PortError } from "@/lib/ports/common";
import type { TastePort } from "@/lib/ports/taste";
import {
  assertNoPersonalData,
  personalTermsFromDisplayName,
  TasteInsightsQuery,
  TasteSearchQuery,
  withPersonalDataGuard,
} from "@/lib/ports/taste";

const ctx = { traceId: "t", logger: pino({ level: "silent" }) };
const emptyCall = { endpoint: "/search" as const, params: {}, resultCount: 0, durationMs: 0, cached: false, source: "mock" as const };

describe("TastePort query schemas cannot carry personal data", () => {
  it("rejects unknown keys such as a person's name or notes", () => {
    expect(() =>
      TasteSearchQuery.parse({ query: "Frank Sinatra", types: ["urn:entity:artist"], personName: "Maria" }),
    ).toThrow();
    expect(() => TasteInsightsQuery.parse({ type: "urn:entity:movie", notes: "born in Naples" })).toThrow();
    expect(() =>
      TasteInsightsQuery.parse({ type: "urn:entity:movie", era: { releaseYear: { min: 1952, max: 1972 } } }),
    ).not.toThrow();
  });
});

describe("personal-data guard", () => {
  const terms = personalTermsFromDisplayName("Nonna Maria");

  it("blocks the display name, whole or as a single word, anywhere in the query", () => {
    expect(() => assertNoPersonalData({ query: "Nonna Maria", types: [] }, terms)).toThrow(PortError);
    expect(() => assertNoPersonalData({ query: "maria" }, terms)).toThrow(PortError);
    expect(() => assertNoPersonalData({ seedEntityIds: ["x"], locationQuery: "Nonna Maria's street" }, terms)).toThrow();
  });

  it("allows public cultural entities that share a first name", () => {
    expect(() => assertNoPersonalData({ query: "Maria Callas" }, terms)).not.toThrow();
    expect(() => assertNoPersonalData({ locationQuery: "Naples" }, terms)).not.toThrow();
  });

  it("decorates a port and never calls it with a blocked query", async () => {
    let calls = 0;
    const port: TastePort = {
      mode: "mock",
      search: async () => (calls++, { items: [], request: emptyCall }),
      getEntities: async () => (calls++, { items: [], request: emptyCall }),
      insights: async () => (calls++, { items: [], request: emptyCall }),
      searchTags: async () => (calls++, { items: [], request: emptyCall }),
    };
    const guarded = withPersonalDataGuard(port, terms);
    expect(() => guarded.search({ query: "Maria", types: ["urn:entity:person"] }, ctx)).toThrow(PortError);
    await guarded.search({ query: "Renato Carosone", types: ["urn:entity:artist"] }, ctx);
    expect(calls).toBe(1);
  });
});
