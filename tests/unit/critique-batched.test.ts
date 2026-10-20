import { describe, expect, it } from "vitest";

import { SAMPLE_ANCHORS } from "@/lib/domain/sample-events";
import type { AgentEventPayload, Anchors, PersonInput } from "@/lib/domain/types";
import { critiqueBatch, critiquePhase } from "@/lib/agent/phases/critique-compose";
import type { Material } from "@/lib/agent/run";
import { createRun } from "@/lib/agent/run";
import { loadConfig } from "@/lib/config";
import type { AgentDeps, LlmPort, LlmRequest, LlmResult } from "@/lib/ports";
import { critiqueItemsPrompt } from "@/lib/prompts";
import type { CritiqueItem } from "@/lib/prompts/critique-items";

import { silentLogger, testCtx } from "./helpers";

const RUBY_ANCHORS: Anchors = {
  ...SAMPLE_ANCHORS,
  birthYear: 1946,
  formativeWindow: { startYear: 1956, endYear: 1976 },
  places: [{ name: "Memphis", countryCode: "US", role: "birthplace", fromYear: 1946 }],
  languages: [{ tag: "en", name: "English" }],
};

const PERSON: PersonInput = {
  notes: "Miss Ruby, born 1946, early stage, loves gospel and soul.",
  birthYear: 1946,
  stage: "early",
  sessionLanguage: "en",
  caregiverLanguage: "en",
  sessionMinutes: 20,
};

const mat = (ref: string, label: string, year: number): Material => ({
  ref,
  label,
  domain: "music",
  year,
  source: "qloo-verified",
});

const MATERIALS: Material[] = [
  mat("a", "Aretha Franklin, defined the 1980s", 1985),
  mat("b", "Obscure Polka Band", 1962),
  mat("c", "Sam Cooke", 1964),
  mat("d", "Mahalia Jackson", 1958),
  mat("e", "Otis Redding", 1967),
];

type Raw = { verdicts?: unknown[]; notes?: unknown };

/** LLM double: returns a scripted object, records every request, never touches the network. */
function fakeLlm(script: Raw | (() => Raw) | Error): { llm: LlmPort; requests: LlmRequest<unknown>[] } {
  const requests: LlmRequest<unknown>[] = [];
  const llm: LlmPort = {
    mode: "mock",
    provider: "fake",
    model: "fake-1",
    async generateObject<T>(request: LlmRequest<T>): Promise<LlmResult<T>> {
      requests.push(request as LlmRequest<unknown>);
      if (script instanceof Error) throw script;
      const object = (typeof script === "function" ? script() : script) as unknown as T;
      return { object, cached: false, provider: "fake", model: "fake-1", latencyMs: 1 };
    },
  };
  return { llm, requests };
}

function makeRun(llm: LlmPort) {
  const deps = {
    llm,
    taste: {} as AgentDeps["taste"],
    cache: {} as AgentDeps["cache"],
    config: loadConfig({}),
    now: () => new Date("2026-01-01T00:00:00Z"),
    newId: (p: string) => `${p}_x`,
  } satisfies AgentDeps;
  return createRun(deps, { ...testCtx(), logger: silentLogger }, []);
}

const items: CritiqueItem[] = MATERIALS.map((m, i) => ({ ref: `m${i + 1}`, label: m.label, domain: m.domain, year: m.year, source: m.source }));

const keepV = (ref: string) => ({ ref, keep: true, kind: "none", reason: "" });
const SCRIPT: Raw = {
  verdicts: [
    { ref: "m1", keep: false, kind: "anachronism", reason: "1985 is nine years past her 1976 formative window." },
    { ref: "m2", keep: false, kind: "low_relevance", reason: "Obscure polka band, weak fit for Memphis soul." },
    keepV("m3"),
    keepV("m4"),
    keepV("m5"),
  ],
  notes: [],
};

describe("critique batching", () => {
  it("judges 5 items in a single LLM call and returns 5 judgments", async () => {
    const { llm, requests } = fakeLlm(SCRIPT);
    const run = makeRun(llm);
    const { judgments } = await critiqueBatch(run, RUBY_ANCHORS, PERSON, items);
    expect(requests).toHaveLength(1);
    expect(requests[0].promptId).toBe(critiqueItemsPrompt.id);
    expect(judgments.size).toBe(5);
    expect([...judgments.keys()]).toEqual(["m1", "m2", "m3", "m4", "m5"]);
    run.dispose();
  });

  it("flags an out-of-window item as anachronism, not low_relevance", async () => {
    const { llm } = fakeLlm(SCRIPT);
    const run = makeRun(llm);
    const { judgments } = await critiqueBatch(run, RUBY_ANCHORS, PERSON, items);
    expect(judgments.get("m1")).toMatchObject({ keep: false, kind: "anachronism" });
    run.dispose();
  });

  it("flags in-era weak fit as low_relevance and in-era strong fit as keep", async () => {
    const { llm } = fakeLlm(SCRIPT);
    const run = makeRun(llm);
    const { judgments } = await critiqueBatch(run, RUBY_ANCHORS, PERSON, items);
    expect(judgments.get("m2")).toMatchObject({ keep: false, kind: "low_relevance" });
    expect(judgments.get("m3")).toMatchObject({ keep: true, kind: "none", reason: "" });
    run.dispose();
  });

  it("treats a malformed or missing judgment as keep and still processes the rest", async () => {
    const { llm } = fakeLlm({
      verdicts: [
        { ref: "m1", keep: false, kind: "anachronism", reason: "1985 is past her window." },
        { ref: "m2", keep: "nope", kind: 42 },
        { ref: "ghost", keep: false, kind: "anachronism", reason: "unknown ref" },
        { ref: "m4", keep: false, kind: "low_relevance", reason: "Weak fit." },
      ],
      notes: [],
    });
    const run = makeRun(llm);
    const { judgments } = await critiqueBatch(run, RUBY_ANCHORS, PERSON, items);
    expect(judgments.size).toBe(5);
    expect(judgments.get("m1")?.keep).toBe(false);
    expect(judgments.get("m2")?.keep).toBe(true);
    expect(judgments.get("m3")?.keep).toBe(true);
    expect(judgments.get("m4")).toMatchObject({ keep: false, kind: "low_relevance" });
    expect(judgments.get("m5")?.keep).toBe(true);
    run.dispose();
  });

  it("keeps everything when the whole call fails instead of throwing", async () => {
    const { llm } = fakeLlm(new Error("boom"));
    const run = makeRun(llm);
    const { judgments } = await critiqueBatch(run, RUBY_ANCHORS, PERSON, items);
    expect([...judgments.values()].every((j) => j.keep)).toBe(true);
    run.dispose();
  });

  it("critiquePhase emits one rejected event per rejected item and returns the kept materials", async () => {
    const { llm, requests } = fakeLlm(SCRIPT);
    const run = makeRun(llm);
    const events: AgentEventPayload[] = [];
    const gen = critiquePhase(run, RUBY_ANCHORS, PERSON, MATERIALS);
    let next = await gen.next();
    while (!next.done) {
      events.push(next.value);
      next = await gen.next();
    }
    const rejected = events.filter((e) => e.type === "rejected");
    expect(requests).toHaveLength(1);
    expect(rejected.map((e) => (e.type === "rejected" ? [e.item.refId, e.item.kind] : []))).toEqual([
      ["a", "anachronism"],
      ["b", "low_relevance"],
    ]);
    expect(next.value.map((m) => m.ref)).toEqual(["c", "d", "e"]);
    run.dispose();
  });

  it("states the sharpened anachronism rules in the system prompt", () => {
    expect(critiqueItemsPrompt.system).toContain("more than 3 years");
    expect(critiqueItemsPrompt.system).toContain("not interchangeable");
    expect(critiqueItemsPrompt.system).toContain("defined the 1980s");
  });
});
