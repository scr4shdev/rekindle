import { describe, expect, it } from "vitest";

import { composePhase } from "@/lib/agent/phases/critique-compose";
import type { Material } from "@/lib/agent/run";
import { createRun } from "@/lib/agent/run";
import { loadConfig } from "@/lib/config";
import { SAMPLE_ANCHORS } from "@/lib/domain/sample-events";
import type { AgentEventPayload, DementiaStage, PersonInput, SessionPlan, TasteDomain, VerifiedEntity } from "@/lib/domain/types";
import type { AgentDeps, LlmPort, LlmResult } from "@/lib/ports";
import type { ComposeSessionOutput } from "@/lib/prompts/compose-session";

import { silentLogger, testCtx } from "./helpers";

const entity = (id: string, name: string, domain: TasteDomain): VerifiedEntity => ({
  id,
  qlooId: `Q-${id}`,
  name,
  domain,
  qlooType: domain === "music" ? "urn:entity:artist" : "urn:entity:movie",
  provenance: "llm-proposed-qloo-verified",
});

const verified = (id: string, label: string, domain: TasteDomain, year = 1962): Material => ({
  ref: id,
  label,
  domain,
  year,
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
  lifePhase: "none",
  fallbackReason: "none",
  ...s,
});

const opening = step({ kind: "opening" });
const closing = step({ kind: "closing" });

function scripted(steps: ComposeSessionOutput["steps"]): LlmPort {
  return {
    mode: "mock",
    provider: "fake",
    model: "fake-1",
    async generateObject<T>(): Promise<LlmResult<T>> {
      const object = { title: "Evening", disclaimer: "Not medical advice.", steps } as unknown as T;
      return { object, cached: false, provider: "fake", model: "fake-1", latencyMs: 1 };
    },
  };
}

async function runCompose(opts: {
  stage: DementiaStage;
  kept: Material[];
  steps: ComposeSessionOutput["steps"];
  unverified?: TasteDomain[];
  sessionMinutes?: number;
}): Promise<SessionPlan> {
  let n = 0;
  const deps = {
    llm: scripted(opts.steps),
    taste: { mode: "mock" } as AgentDeps["taste"],
    cache: {} as AgentDeps["cache"],
    config: loadConfig({}),
    now: () => new Date("2026-01-01T00:00:00Z"),
    newId: (p: string) => `${p}_${++n}`,
  } satisfies AgentDeps;
  const run = createRun(deps, { ...testCtx(), logger: silentLogger }, []);
  for (const d of opts.unverified ?? []) run.unverifiedDomains.add(d);
  const person: PersonInput = {
    notes: "Fatima, born 1954 in Casablanca, loves Oum Kalthoum.",
    birthYear: 1954,
    stage: opts.stage,
    sessionLanguage: "en",
    caregiverLanguage: "en",
    sessionMinutes: opts.sessionMinutes ?? 20,
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
  return plan!;
}

describe("deterministic post-compose minimum enforcement", () => {
  it("mid-stage: 2 music composed, 4 music verified (2 unused): fills to 3 music with a min_enforcement swap", async () => {
    const kept: Material[] = [
      verified("m_a", "Oum Kalthoum", "music"),
      verified("m_b", "Fairuz", "music"),
      verified("m_c", "Abdel Halim Hafez", "music"),
      verified("m_d", "Mohammed Abdel Wahab", "music"),
      verified("t_a", "Mint tea", "food"),
      verified("l_a", "Casablanca medina", "place"),
    ];
    const plan = await runCompose({
      stage: "mid",
      kept,
      steps: [
        opening,
        step({ kind: "listen", materialRef: "m1" }),
        step({ kind: "taste", materialRef: "m5" }),
        step({ kind: "listen", materialRef: "m2" }),
        step({ kind: "look", materialRef: "m6" }),
        closing,
      ],
    });
    const music = plan.steps.filter((s) => s.entity?.domain === "music");
    expect(music).toHaveLength(3);
    const enforced = plan.steps.filter((s) => s.fallbackReason === "min_enforcement");
    expect(enforced).toHaveLength(1);
    const nonMusicKinds = plan.steps.filter((s) => s.kind !== "opening" && s.kind !== "closing" && s.entity?.domain !== "music");
    expect(nonMusicKinds).toHaveLength(1);
    expect(["taste", "look"]).toContain(nonMusicKinds[0].kind);
    expect(plan.coverageGaps).toBeUndefined();
  });

  it("materials short: 2 music composed, 2 verified total (both used): leaves honest coverageGaps, no min_enforcement", async () => {
    const kept: Material[] = [
      verified("m_a", "Oum Kalthoum", "music"),
      verified("m_b", "Fairuz", "music"),
      verified("t_a", "Mint tea", "food"),
      verified("l_a", "Casablanca medina", "place"),
    ];
    const plan = await runCompose({
      stage: "mid",
      kept,
      steps: [
        opening,
        step({ kind: "listen", materialRef: "m1" }),
        step({ kind: "taste", materialRef: "m3" }),
        step({ kind: "listen", materialRef: "m2" }),
        step({ kind: "look", materialRef: "m4" }),
        closing,
      ],
    });
    const music = plan.steps.filter((s) => s.entity?.domain === "music");
    expect(music).toHaveLength(2);
    expect(plan.steps.find((s) => s.fallbackReason === "min_enforcement")).toBeUndefined();
    expect(plan.coverageGaps).toEqual([{ domain: "music", requiredCount: 3, actualCount: 2, reason: "composer_omitted" }]);
  });

  it("minimum already met: enforcement is a no-op (no min_enforcement marker, no coverageGaps)", async () => {
    const kept: Material[] = [
      verified("m_a", "Oum Kalthoum", "music"),
      verified("m_b", "Fairuz", "music"),
      verified("m_c", "Abdel Halim Hafez", "music"),
      verified("m_d", "Mohammed Abdel Wahab", "music"),
      verified("t_a", "Mint tea", "food"),
    ];
    const plan = await runCompose({
      stage: "mid",
      kept,
      steps: [
        opening,
        step({ kind: "listen", materialRef: "m1" }),
        step({ kind: "listen", materialRef: "m2" }),
        step({ kind: "taste", materialRef: "m5" }),
        step({ kind: "listen", materialRef: "m3" }),
        closing,
      ],
    });
    expect(plan.steps.filter((s) => s.entity?.domain === "music")).toHaveLength(3);
    expect(plan.steps.find((s) => s.fallbackReason === "min_enforcement")).toBeUndefined();
    expect(plan.coverageGaps).toBeUndefined();
  });

  it("no body step is swappable (only opening, music step and closing): plan unchanged, honest coverageGaps", async () => {
    const kept: Material[] = [
      verified("m_a", "Oum Kalthoum", "music"),
      verified("m_b", "Fairuz", "music"),
    ];
    const plan = await runCompose({
      stage: "mid",
      kept,
      steps: [
        opening,
        step({ kind: "listen", materialRef: "m1" }),
        closing,
      ],
    });
    expect(plan.steps).toHaveLength(3);
    expect(plan.steps[0].kind).toBe("opening");
    expect(plan.steps[2].kind).toBe("closing");
    expect(plan.steps.find((s) => s.fallbackReason === "min_enforcement")).toBeUndefined();
    expect(plan.coverageGaps).toEqual([{ domain: "music", requiredCount: 3, actualCount: 1, reason: "composer_omitted" }]);
  });

  it("determinism: identical inputs produce identical steps (kinds, titles, order, fallback markers)", async () => {
    const build = () => {
      const kept: Material[] = [
        verified("m_a", "Oum Kalthoum", "music"),
        verified("m_b", "Fairuz", "music"),
        verified("m_c", "Abdel Halim Hafez", "music"),
        verified("m_d", "Mohammed Abdel Wahab", "music"),
        verified("t_a", "Mint tea", "food"),
        verified("l_a", "Casablanca medina", "place"),
      ];
      const steps = [
        opening,
        step({ kind: "listen", materialRef: "m1" }),
        step({ kind: "taste", materialRef: "m5" }),
        step({ kind: "listen", materialRef: "m2" }),
        step({ kind: "look", materialRef: "m6" }),
        closing,
      ];
      return { kept, steps };
    };
    const first = await runCompose({ stage: "mid", ...build() });
    const second = await runCompose({ stage: "mid", ...build() });
    const shape = (p: SessionPlan) =>
      p.steps.map((s) => ({
        order: s.order,
        kind: s.kind,
        title: s.title,
        entityName: s.entity?.name,
        fallbackReason: s.fallbackReason,
      }));
    expect(shape(first)).toEqual(shape(second));
    expect(first.coverageGaps).toEqual(second.coverageGaps);
  });

  it("the swap picks an unused verified entity, never one already placed", async () => {
    const kept: Material[] = [
      verified("m_a", "Oum Kalthoum", "music"),
      verified("m_b", "Fairuz", "music"),
      verified("m_c", "Abdel Halim Hafez", "music"),
      verified("t_a", "Mint tea", "food"),
      verified("l_a", "Casablanca medina", "place"),
    ];
    const plan = await runCompose({
      stage: "mid",
      kept,
      steps: [
        opening,
        step({ kind: "listen", materialRef: "m1" }),
        step({ kind: "taste", materialRef: "m4" }),
        step({ kind: "listen", materialRef: "m2" }),
        step({ kind: "look", materialRef: "m5" }),
        closing,
      ],
    });
    const enforced = plan.steps.find((s) => s.fallbackReason === "min_enforcement");
    expect(enforced).toBeDefined();
    expect(enforced!.entity?.name).toBe("Abdel Halim Hafez");
    const qlooIds = plan.steps.map((s) => s.entity?.qlooId).filter((q): q is string => Boolean(q));
    expect(new Set(qlooIds).size).toBe(qlooIds.length);
  });
});
