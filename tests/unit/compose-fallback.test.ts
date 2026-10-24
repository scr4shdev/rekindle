import { describe, expect, it } from "vitest";

import { composePhase } from "@/lib/agent/phases/critique-compose";
import type { Material } from "@/lib/agent/run";
import { createRun } from "@/lib/agent/run";
import { computeCoverageGaps, STAGE_DOMAIN_MINIMUMS, stageMinimums } from "@/lib/agent/stage-policy";
import { loadConfig } from "@/lib/config";
import { SAMPLE_ANCHORS } from "@/lib/domain/sample-events";
import type { AgentEventPayload, DementiaStage, PersonInput, SessionPlan, TasteDomain, VerifiedEntity } from "@/lib/domain/types";
import type { AgentDeps, LlmPort, LlmRequest, LlmResult } from "@/lib/ports";
import type { ComposeSessionOutput } from "@/lib/prompts/compose-session";
import * as compose from "@/lib/prompts/compose-session";

import { silentLogger, testCtx } from "./helpers";

const entity = (id: string, name: string, domain: TasteDomain): VerifiedEntity => ({
  id,
  qlooId: `Q-${id}`,
  name,
  domain,
  qlooType: domain === "music" ? "urn:entity:artist" : "urn:entity:movie",
  provenance: "llm-proposed-qloo-verified",
});

const verified = (id: string, label: string, domain: TasteDomain): Material => ({
  ref: id,
  label,
  domain,
  year: 1962,
  source: "qloo-verified",
  entity: entity(id, label, domain),
});

type ModelStepInput = Partial<ComposeSessionOutput["steps"][number]> & Pick<ComposeSessionOutput["steps"][number], "kind">;

const step = (s: ModelStepInput): ComposeSessionOutput["steps"][number] => ({
  title: s.kind,
  materialRef: "",
  prompt: `A ${s.kind} step for 1962.`,
  promptTranslation: "",
  followUps: [],
  caregiverTip: "A tip.",
  durationMin: 3,
  mediaHint: "",
  mediaHost: "none",
  lifePhase: "none",
  fallbackReason: "none",
  ...s,
});

const opening = step({ kind: "opening" });
const closing = step({ kind: "closing" });

function scripted(steps: ComposeSessionOutput["steps"]): { llm: LlmPort; requests: LlmRequest<unknown>[] } {
  const requests: LlmRequest<unknown>[] = [];
  const llm: LlmPort = {
    mode: "mock",
    provider: "fake",
    model: "fake-1",
    async generateObject<T>(request: LlmRequest<T>): Promise<LlmResult<T>> {
      requests.push(request as LlmRequest<unknown>);
      const object = { title: "Evening", disclaimer: "Not medical advice.", steps } as unknown as T;
      return { object, cached: false, provider: "fake", model: "fake-1", latencyMs: 1 };
    },
  };
  return { llm, requests };
}

async function runCompose(opts: {
  stage: DementiaStage;
  kept: Material[];
  steps: ComposeSessionOutput["steps"];
  unverified?: TasteDomain[];
}): Promise<{ plan: SessionPlan; requests: LlmRequest<unknown>[] }> {
  const { llm, requests } = scripted(opts.steps);
  let n = 0;
  const deps = {
    llm,
    taste: { mode: "mock" } as AgentDeps["taste"],
    cache: {} as AgentDeps["cache"],
    config: loadConfig({}),
    now: () => new Date("2026-01-01T00:00:00Z"),
    newId: (p: string) => `${p}_${++n}`,
  } satisfies AgentDeps;
  const run = createRun(deps, { ...testCtx(), logger: silentLogger }, []);
  for (const d of opts.unverified ?? []) run.unverifiedDomains.add(d);
  const person: PersonInput = {
    notes: "Seamus, born 1938 in Cork, loves showband music.",
    birthYear: 1938,
    stage: opts.stage,
    sessionLanguage: "en",
    caregiverLanguage: "en",
    sessionMinutes: 25,
  };
  const gen = composePhase(run, SAMPLE_ANCHORS, person, "grounded", opts.kept, new Set());
  let plan: SessionPlan | undefined;
  for (;;) {
    const next = await gen.next();
    if (next.done) break;
    const payload: AgentEventPayload = next.value;
    if (payload.type === "plan") plan = payload.plan;
  }
  run.dispose();
  return { plan: plan!, requests };
}

describe("stage policy", () => {
  it("renders the per-stage table as data for the prompt (music only, early 2, mid 3, late 1)", () => {
    expect(stageMinimums("early")).toEqual([{ domain: "music", minSteps: 2, stepKinds: ["listen", "move"] }]);
    expect(stageMinimums(undefined)).toEqual(stageMinimums("early"));
    expect(stageMinimums("mid")[0].minSteps).toBe(3);
    expect(stageMinimums("late")[0].minSteps).toBe(1);
    expect(STAGE_DOMAIN_MINIMUMS.early.music).toBe(2);
  });

  it("passes the policy to the prompt render instead of hardcoding counts in prose", async () => {
    const m = verified("m_a", "The Dubliners", "music");
    const { requests } = await runCompose({
      stage: "mid",
      kept: [m],
      steps: [opening, step({ kind: "listen", materialRef: "m1" }), closing],
    });
    expect(requests[0].prompt).toContain('<data name="stage_minimums">');
    expect(requests[0].prompt).toContain('"minSteps": 3');
    expect(compose.VERSION).not.toBe("1.5.0");
  });
});

describe("compose fallback branching", () => {
  it("primary music anchor verified: music step sits on it, no fallback, no gap", async () => {
    const kept = [verified("m_a", "The Dubliners", "music")];
    const { plan } = await runCompose({
      stage: "late",
      kept,
      steps: [opening, step({ kind: "listen", materialRef: "m1", fallbackReason: "none" }), closing],
    });
    const music = plan.steps.filter((s) => s.kind === "listen");
    expect(music).toHaveLength(1);
    expect(music[0].entity?.name).toBe("The Dubliners");
    expect(music[0].fallbackReason).toBeUndefined();
    expect(plan.coverageGaps).toBeUndefined();
  });

  it("primary anchor missing, one alternative verified: fallback step carries primary_not_verified", async () => {
    const kept = [verified("m_a", "Planxty", "music")];
    const { plan } = await runCompose({
      stage: "early",
      kept,
      unverified: ["music"],
      steps: [
        opening,
        step({ kind: "listen", materialRef: "m1", fallbackReason: "primary_not_verified" }),
        step({ kind: "listen", materialRef: "", fallbackReason: "no_viable_alternative" }),
        closing,
      ],
    });
    const fallback = plan.steps.find((s) => s.entity?.name === "Planxty");
    expect(fallback?.fallbackReason).toBe("primary_not_verified");
    expect(plan.steps.filter((s) => s.kind === "listen")).toHaveLength(2);
    expect(plan.steps.find((s) => s.provenance === "llm-only" && s.kind === "listen")?.fallbackReason).toBe("no_viable_alternative");
    expect(plan.coverageGaps).toBeUndefined();
    // Markers never land on opening or closing.
    expect(plan.steps[0].fallbackReason).toBeUndefined();
  });

  it("alternative exists but the composer used only one music step: gap says primary_not_verified when the anchor failed verification", async () => {
    const { plan } = await runCompose({
      stage: "early",
      kept: [verified("m_a", "Planxty", "music")],
      unverified: ["music"],
      steps: [opening, step({ kind: "listen", materialRef: "m1", fallbackReason: "primary_not_verified" }), step({ kind: "talk" }), closing],
    });
    expect(plan.coverageGaps).toEqual([{ domain: "music", requiredCount: 2, actualCount: 1, reason: "primary_not_verified" }]);
  });

  it("no music verified at all: coverageGaps reports no_viable_alternative with actual 0", async () => {
    const { plan } = await runCompose({
      stage: "early",
      kept: [verified("f_a", "The Quiet Man", "film")],
      unverified: ["music"],
      steps: [opening, step({ kind: "look", materialRef: "m1" }), step({ kind: "talk" }), closing],
    });
    expect(plan.coverageGaps).toEqual([{ domain: "music", requiredCount: 2, actualCount: 0, reason: "no_viable_alternative" }]);
  });
});

describe("computeCoverageGaps", () => {
  it("does not count a listen step built on a non-music material (domain comes from the structured field)", () => {
    const gaps = computeCoverageGaps({
      stage: "late",
      steps: [{ kind: "listen", materialDomain: "television" }],
      availableDomains: ["television", "music"],
      unverifiedDomains: new Set(),
    });
    expect(gaps).toEqual([{ domain: "music", requiredCount: 1, actualCount: 0, reason: "composer_omitted" }]);
  });

  it("move steps count toward the music minimum", () => {
    const gaps = computeCoverageGaps({
      stage: "early",
      steps: [{ kind: "listen", materialDomain: "music" }, { kind: "move" }],
      availableDomains: ["music"],
      unverifiedDomains: new Set(),
    });
    expect(gaps).toEqual([]);
  });
});
