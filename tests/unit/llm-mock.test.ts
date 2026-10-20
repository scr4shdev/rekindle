import { describe, expect, it } from "vitest";

import { MemoryCache } from "@/lib/adapters/cache";
import { MockLlm } from "@/lib/adapters/llm/mock";
import { SAMPLE_ANCHORS } from "@/lib/domain/sample-events";
import { PERSONAS } from "@/lib/personas";
import { buildLlmRequest } from "@/lib/ports/llm";
import {
  composeSessionPrompt,
  critiqueItemsPrompt,
  matchEntityPrompt,
  parseAnchorsPrompt,
  proposeCandidatesPrompt,
  replanSessionPrompt,
} from "@/lib/prompts";
import { DISCLAIMER_EN } from "@/lib/prompts/compose-session";
import type { ParseAnchorsInput } from "@/lib/prompts/parse-anchors";

import { testCtx } from "./helpers";

const llm = new MockLlm();
const ctx = testCtx();

const parseInput = (notes: string, extra: Partial<ParseAnchorsInput> = {}): ParseAnchorsInput => ({
  notes,
  sessionLanguage: "en",
  caregiverLanguage: "en",
  currentYear: 2026,
  formativeAgeMin: 10,
  formativeAgeMax: 30,
  ...extra,
});

describe("MockLlm", () => {
  it.each(PERSONAS.map((p) => [p.slug, p] as const))("parses persona %s into schema-valid anchors", async (_slug, persona) => {
    const res = await llm.generateObject(buildLlmRequest(parseAnchorsPrompt, parseInput(persona.input.notes)), ctx);
    expect(res).toMatchObject({ cached: false, provider: "mock", model: "mock-llm" });
    expect(res.object.birthYear).toBe(persona.input.birthYear);
    expect(res.object.sensitivities.length).toBeGreaterThan(0);
  });

  it("matches Maria's sample anchors", async () => {
    const maria = PERSONAS.find((p) => p.slug === "maria")!;
    const res = await llm.generateObject(buildLlmRequest(parseAnchorsPrompt, parseInput(maria.input.notes)), ctx);
    expect(res.object.summary).toBe(SAMPLE_ANCHORS.summary);
    expect(res.object.loves).toEqual(SAMPLE_ANCHORS.loves);
    expect(res.object.privateNames).toContain("Gennaro");
  });

  it("uses only structured fields for custom input: different notes give the same output", async () => {
    const extra = { birthYear: 1955, birthPlace: "Lyon, France", sessionLanguage: "fr" };
    const a = await llm.generateObject(buildLlmRequest(parseAnchorsPrompt, parseInput("He loved jazz and Brigitte Bardot.", extra)), ctx);
    const b = await llm.generateObject(buildLlmRequest(parseAnchorsPrompt, parseInput("Elle adorait la mer et les chats.", extra)), ctx);
    expect(a.object).toEqual(b.object);
    expect(a.object.places[0].name).toBe("Lyon, France");
    expect(a.object.languages.map((l) => l.tag)).toEqual(["fr", "en"]);
    const inferred = await llm.generateObject(buildLlmRequest(parseAnchorsPrompt, parseInput("Some notes here.")), ctx);
    expect(inferred.object).toMatchObject({ birthYear: 1946, birthYearSource: "inferred", places: [] });
  });

  it("proposes Maria's sample candidates, and era-filtered generic candidates for custom input", async () => {
    const domains = [{ domain: "music" as const, qlooTypes: ["urn:entity:artist"] }];
    const maria = await llm.generateObject(
      buildLlmRequest(proposeCandidatesPrompt, { anchors: SAMPLE_ANCHORS, maxPerDomain: 5, domains, caregiverLanguage: "en" }),
      ctx,
    );
    expect(maria.object.candidates.map((c) => c.name)).toContain("Renato Carosone");
    const custom = { ...SAMPLE_ANCHORS, summary: "custom", birthYear: 1950, formativeWindow: { startYear: 1960, endYear: 1980 } };
    const generic = await llm.generateObject(
      buildLlmRequest(proposeCandidatesPrompt, { anchors: custom, maxPerDomain: 5, domains, caregiverLanguage: "en" }),
      ctx,
    );
    const years = generic.object.candidates.filter((c) => c.year > 0).map((c) => c.year);
    expect(years.every((y) => y >= 1957 && y <= 1983)).toBe(true);
    expect(generic.object.candidates.some((c) => c.qlooType === "none")).toBe(true);
  });

  it("matches spelling variants only within the same type", async () => {
    const results = [
      { index: 0, name: "Abdelhalim Hafez", type: "urn:entity:movie" },
      { index: 1, name: "Abdelhalim Hafez", type: "urn:entity:artist" },
    ];
    const origin = { languages: ["ar"], formativeWindow: { startYear: 1950, endYear: 1970 } };
    const res = await llm.generateObject(
      buildLlmRequest(matchEntityPrompt, { candidate: { name: "Abdel Halim Hafez", domain: "music", qlooType: "urn:entity:artist" }, origin, results }),
      ctx,
    );
    expect(res.object.matchIndex).toBe(1);
    const none = await llm.generateObject(
      buildLlmRequest(matchEntityPrompt, { candidate: { name: "Totally different", domain: "music", qlooType: "urn:entity:artist" }, origin, results }),
      ctx,
    );
    expect(none.object.matchIndex).toBe(-1);
  });

  it("critiques with persona verdicts, year rules and duplicates", async () => {
    const items = [
      { ref: "a", label: "Pino Daniele", domain: "music", year: 1977, source: "qloo-verified" as const },
      { ref: "b", label: "Renato Carosone", domain: "music", year: 1956, source: "qloo-verified" as const },
      { ref: "c", label: "Renato  Carosone", domain: "music", source: "qloo-affinity" as const },
      { ref: "d", label: "Somebody Young", domain: "music", bornYear: 1975, source: "qloo-affinity" as const },
    ];
    const res = await llm.generateObject(buildLlmRequest(critiqueItemsPrompt, { anchors: SAMPLE_ANCHORS, caregiverLanguage: "en", items }), ctx);
    expect(res.object.verdicts.map((v) => [v.ref, v.keep, v.kind])).toEqual([
      ["a", false, "anachronism"],
      ["b", true, "none"],
      ["c", false, "duplicate"],
      ["d", false, "anachronism"],
    ]);
  });

  it("composes and replans schema-valid output", async () => {
    const materials = [
      { ref: "m1", label: "Frank Sinatra", domain: "music", source: "qloo-verified" as const },
      { ref: "m2", label: "Ragù napoletano", domain: "food", source: "llm-idea" as const },
    ];
    const composed = await llm.generateObject(
      buildLlmRequest(composeSessionPrompt, {
        anchors: SAMPLE_ANCHORS, sessionLanguage: "it", caregiverLanguage: "en", sessionMinutes: 20, maxSteps: 8,
        disclaimerEnglish: DISCLAIMER_EN, materials,
      }),
      ctx,
    );
    expect(composed.object.steps.map((s) => s.kind)).toEqual(["opening", "listen", "taste", "closing"]);
    expect(composed.object.steps[1].materialRef).toBe("m1");

    const summary = (id: string, kind: string, domain?: string) => ({ id, title: id, kind, domain, durationMin: 3 });
    const replanned = await llm.generateObject(
      buildLlmRequest(replanSessionPrompt, {
        anchors: SAMPLE_ANCHORS, sessionLanguage: "it", caregiverLanguage: "en", reaction: "upset",
        reactedStep: summary("s_oro", "look", "film"), history: [], done: [summary("s_oro", "look", "film")],
        upcoming: [summary("s_napoli", "talk", "sport"), summary("s_close", "closing")], newMaterials: [], minutesRemaining: 8, maxUpcoming: 6,
      }),
      ctx,
    );
    expect(replanned.object.removed.map((r) => r.stepId)).toEqual(["s_napoli"]);
    expect(replanned.object.upcoming.map((u) => u.keepStepId)).toEqual(["", "s_close"]);
  });

  it("caches through the injected cache and rejects unknown prompts", async () => {
    const cached = new MockLlm({ cache: new MemoryCache(), cacheTtlSeconds: 60 });
    const req = buildLlmRequest(parseAnchorsPrompt, parseInput("Notes long enough."), { sensitive: true });
    expect((await cached.generateObject(req, ctx)).cached).toBe(false);
    expect((await cached.generateObject(req, ctx)).cached).toBe(true);
    await expect(llm.generateObject({ ...req, promptId: "nope" }, ctx)).rejects.toMatchObject({ code: "bad_request" });
  });
});
