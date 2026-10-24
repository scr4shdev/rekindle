/**
 * Deterministic post-compose minimum enforcement must respect the session
 * and caregiver languages. The audit flagged a blocker where a Fatima
 * (fr) run with an undershoot injected English text into the plan.
 *
 * These cases force an enforcement swap and assert the enforced step's
 * prompt, tip and mediaHint come from the per-locale i18n table, and that
 * promptTranslation is set when the two languages differ.
 */
import { describe, expect, it } from "vitest";

import { composePhase } from "@/lib/agent/phases/critique-compose";
import type { Material } from "@/lib/agent/run";
import { createRun } from "@/lib/agent/run";
import { loadConfig } from "@/lib/config";
import { SAMPLE_ANCHORS } from "@/lib/domain/sample-events";
import type { AgentEventPayload, PersonInput, SessionPlan, TasteDomain, VerifiedEntity } from "@/lib/domain/types";
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
      const object = { title: "Soirée", disclaimer: "Pas un avis médical.", steps } as unknown as T;
      return { object, cached: false, provider: "fake", model: "fake-1", latencyMs: 1 };
    },
  };
}

/** Six-step mid-stage scaffold where exactly one music minimum swap is forced. */
const scaffold = () => {
  const kept: Material[] = [
    verified("m_a", "Oum Kalthoum", "music"),
    verified("m_b", "Fairuz", "music"),
    verified("m_c", "Abdel Halim Hafez", "music"),
    verified("t_a", "Mint tea", "food"),
    verified("l_a", "Casablanca medina", "place"),
  ];
  const steps: ComposeSessionOutput["steps"] = [
    opening,
    step({ kind: "listen", materialRef: "m1" }),
    step({ kind: "taste", materialRef: "m4" }),
    step({ kind: "listen", materialRef: "m2" }),
    step({ kind: "look", materialRef: "m5" }),
    closing,
  ];
  return { kept, steps };
};

async function runCompose(opts: {
  kept: Material[];
  steps: ComposeSessionOutput["steps"];
  sessionLanguage: string;
  caregiverLanguage: string;
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
  const person: PersonInput = {
    notes: "Mid-stage persona who loves North African music.",
    birthYear: 1954,
    stage: "mid",
    sessionLanguage: opts.sessionLanguage,
    caregiverLanguage: opts.caregiverLanguage,
    sessionMinutes: 20,
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

describe("post-compose minimum enforcement is localized by sessionLanguage", () => {
  it("en: enforced step uses English copy and omits promptTranslation", async () => {
    const plan = await runCompose({ ...scaffold(), sessionLanguage: "en", caregiverLanguage: "en" });
    const enforced = plan.steps.find((s) => s.fallbackReason === "min_enforcement");
    expect(enforced).toBeDefined();
    expect(enforced!.entity?.name).toBe("Abdel Halim Hafez");
    expect(enforced!.prompt).toBe("Let us listen together to Abdel Halim Hafez.");
    expect(enforced!.caregiverTip).toBe(
      "Abdel Halim Hafez is a familiar piece from their world; keep it short and let them lead.",
    );
    expect(enforced!.mediaHint).toBe("Search 'Abdel Halim Hafez' on YouTube");
    expect(enforced!.promptTranslation).toBeUndefined();
  });

  it("fr session with fr caregiver: enforced step uses French copy and no translation", async () => {
    const plan = await runCompose({ ...scaffold(), sessionLanguage: "fr", caregiverLanguage: "fr" });
    const enforced = plan.steps.find((s) => s.fallbackReason === "min_enforcement");
    expect(enforced).toBeDefined();
    expect(enforced!.prompt).toBe("Écoutons Abdel Halim Hafez ensemble.");
    expect(enforced!.caregiverTip).toBe(
      "Abdel Halim Hafez fait partie de leur monde musical ; restez bref et laissez-les guider.",
    );
    expect(enforced!.mediaHint).toBe("Chercher 'Abdel Halim Hafez' sur YouTube");
    expect(enforced!.promptTranslation).toBeUndefined();
  });

  it("fr session with en caregiver (Fatima's shape): prompt is French, tip and mediaHint are English, promptTranslation is set", async () => {
    const plan = await runCompose({ ...scaffold(), sessionLanguage: "fr", caregiverLanguage: "en" });
    const enforced = plan.steps.find((s) => s.fallbackReason === "min_enforcement");
    expect(enforced).toBeDefined();
    expect(enforced!.prompt).toBe("Écoutons Abdel Halim Hafez ensemble.");
    expect(enforced!.promptTranslation).toBe("Let us listen together to Abdel Halim Hafez.");
    expect(enforced!.caregiverTip).toBe(
      "Abdel Halim Hafez is a familiar piece from their world; keep it short and let them lead.",
    );
    expect(enforced!.mediaHint).toBe("Search 'Abdel Halim Hafez' on YouTube");
  });

  it("it session with it caregiver: enforced step uses Italian copy", async () => {
    const plan = await runCompose({ ...scaffold(), sessionLanguage: "it", caregiverLanguage: "it" });
    const enforced = plan.steps.find((s) => s.fallbackReason === "min_enforcement");
    expect(enforced).toBeDefined();
    expect(enforced!.prompt).toBe("Ascoltiamo Abdel Halim Hafez insieme.");
    expect(enforced!.caregiverTip).toBe(
      "Abdel Halim Hafez fa parte del loro mondo musicale; mantieni il momento breve e lascia che siano loro a guidare.",
    );
    expect(enforced!.mediaHint).toBe("Cerca 'Abdel Halim Hafez' su YouTube");
    expect(enforced!.promptTranslation).toBeUndefined();
  });

  it("operator jargon stays out of the user-facing tip (no 'anchor', 'minimum', 'verified' in English)", async () => {
    const plan = await runCompose({ ...scaffold(), sessionLanguage: "en", caregiverLanguage: "en" });
    const enforced = plan.steps.find((s) => s.fallbackReason === "min_enforcement");
    const tip = enforced!.caregiverTip ?? "";
    expect(tip).not.toMatch(/anchor/i);
    expect(tip).not.toMatch(/minimum/i);
    expect(tip).not.toMatch(/verified/i);
    expect(tip).not.toMatch(/min_enforcement/);
    expect(tip).not.toMatch(/flex/i);
  });

  it("determinism: identical (locale, materials) inputs produce identical enforced-step copy", async () => {
    const first = await runCompose({ ...scaffold(), sessionLanguage: "fr", caregiverLanguage: "en" });
    const second = await runCompose({ ...scaffold(), sessionLanguage: "fr", caregiverLanguage: "en" });
    const shape = (p: SessionPlan) =>
      p.steps
        .filter((s) => s.fallbackReason === "min_enforcement")
        .map((s) => ({ prompt: s.prompt, tip: s.caregiverTip, mediaHint: s.mediaHint, translation: s.promptTranslation }));
    expect(shape(first)).toEqual(shape(second));
  });
});
