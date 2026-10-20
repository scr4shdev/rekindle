import { describe, expect, it } from "vitest";

import { runSession } from "@/lib/agent";
import type { AgentEvent, AgentEventOf, SessionPlan } from "@/lib/domain/types";
import { SessionPlan as SessionPlanSchema, SessionRequest } from "@/lib/domain/types";
import { PERSONAS } from "@/lib/personas";

import { collect, mockDeps } from "./agent-deps";
import { testCtx } from "./helpers";
import { assertStreamRules } from "./stream-rules";

const ofType = <K extends AgentEvent["type"]>(list: AgentEvent[], type: K) => list.filter((e): e is AgentEventOf<K> => e.type === type);

/**
 * Words that must never appear in a persona's plan.
 * - FORBIDDEN_ALWAYS: true "avoid" sensitivities from the notes. Both modes.
 * - FORBIDDEN_GROUNDED: items grounded Qloo verification catches as
 *   anachronisms or cultural slips. Llm-only mode intentionally lets these
 *   through to demonstrate what Qloo verification adds in the compare view.
 */
const FORBIDDEN_ALWAYS: Record<string, string[]> = {
  maria: ["guerra", "war"],
  seamus: ["emigration", "emigrated", "emigrant"],
  fatima: ["alcohol", "alcool", "bière", "beer"],
};
const FORBIDDEN_GROUNDED: Record<string, string[]> = {
  maria: ["Maradona", "Pino Daniele", "quattro giornate", "Nino D'Angelo"],
  seamus: ["England", "Bridie Gallagher", "U2"],
  fatima: ["Stella Artois", "Khaled", "Donald Trump", "Beatles", "Casablanca"],
};

const summary = (plan: SessionPlan) =>
  plan.steps.map((s) => `${s.order}. [${s.kind}] ${s.title} | ${s.provenance}${s.entity ? ` | ${s.entity.name} (${s.entity.provenance})` : ""} | ${s.durationMin} min`);

describe.each(PERSONAS.map((p) => [p.slug, p] as const))("golden mock run: %s", (slug, persona) => {
  for (const mode of ["grounded", "llm-only"] as const) {
    it(`${mode}: valid, era-correct, sensitivity-safe and stable`, async () => {
      const req = SessionRequest.parse({ person: persona.input, mode });
      const first = await collect(runSession(mockDeps(), req, testCtx()));
      const second = await collect(runSession(mockDeps(), req, testCtx()));
      assertStreamRules(first, "session");

      const plan = ofType(first, "plan")[0].plan;
      expect(SessionPlanSchema.parse(plan)).toEqual(plan);
      expect(plan.totalMinutes).toBe(persona.input.sessionMinutes);
      expect(plan.language).toBe(persona.input.sessionLanguage);
      expect(plan.disclaimer).toMatch(/not medical advice or therapy/);

      // Era: every dated entity in the plan is inside the formative window.
      const { startYear, endYear } = ofType(first, "anchors")[0].anchors.formativeWindow;
      for (const s of plan.steps) {
        if (s.entity?.releaseYear) {
          expect(s.entity.releaseYear).toBeGreaterThanOrEqual(startYear);
          expect(s.entity.releaseYear).toBeLessThanOrEqual(endYear);
        }
      }
      // Sensitivities and rejected items never leak into the plan text.
      // (Human-visible text only: affinity provenance may list every seed that was sent to Qloo.)
      const text = plan.steps
        .flatMap((s) => [s.title, s.prompt, s.promptTranslation, ...s.followUps, s.caregiverTip, s.mediaHint, s.entity?.name, s.entity?.description])
        .filter(Boolean)
        .join(" \n ");
      for (const word of FORBIDDEN_ALWAYS[slug]) expect(text).not.toMatch(new RegExp(`\\b${word}\\b`, "iu"));
      if (mode === "grounded") {
        for (const word of FORBIDDEN_GROUNDED[slug]) expect(text).not.toMatch(new RegExp(`\\b${word}\\b`, "iu"));
      }

      // Prompts are open-ended invitations, not memory quizzes.
      for (const s of plan.steps) expect(s.prompt.toLowerCase()).not.toMatch(/do you remember|si ricorda|vous souvenez/);

      if (mode === "grounded") expect(plan.steps.some((s) => s.provenance === "qloo-grounded")).toBe(true);
      else expect(plan.steps.every((s) => s.provenance === "llm-only")).toBe(true);

      // Determinism: same input, same events and plan.
      const strip = (list: AgentEvent[]) => list.map(({ t, ...rest }) => (void t, rest));
      expect(strip(second)).toEqual(strip(first));
      expect(summary(plan)).toMatchSnapshot();
    });
  }
});

/** Replace generated ids (c_1, ve_12, s_3, plan_4) by their order of first appearance, so runs on shared deps compare. */
function canonical(list: AgentEvent[]): unknown {
  const ids = new Map<string, string>();
  const walk = (v: unknown): unknown => {
    if (typeof v === "string" && /^(c|ve|s|plan)_\d+$/.test(v)) {
      if (!ids.has(v)) ids.set(v, `id${ids.size}`);
      return ids.get(v);
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return list.map(({ t, ...rest }) => {
    void t;
    if (rest.type === "done") return walk({ ...rest, stats: { ...rest.stats, cacheHits: 0 } });
    return walk(rest);
  });
}

describe("golden determinism across the cache", () => {
  it.each(PERSONAS.map((p) => [p.slug, p] as const))("%s: a cache-hit run equals the cache-miss run", async (_slug, persona) => {
    const deps = mockDeps();
    const req = SessionRequest.parse({ person: persona.input });
    const miss = await collect(runSession(deps, req, testCtx()));
    const hit = await collect(runSession(deps, req, testCtx()));
    const missDone = miss.at(-1)!;
    const hitDone = hit.at(-1)!;
    expect(missDone.type === "done" && missDone.stats.cacheHits).toBe(0);
    expect(hitDone.type === "done" && hitDone.stats.cacheHits).toBe(hitDone.type === "done" ? hitDone.stats.llmCalls : -1);
    expect(canonical(hit)).toEqual(canonical(miss));
  });
});
