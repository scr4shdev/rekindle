import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { GENERIC_TEXT } from "@/lib/adapters/llm/fixtures/generic";
import { PERSONA_FIXTURES } from "@/lib/adapters/llm/fixtures/personas";
import { runReplan, runSession } from "@/lib/agent";
import type { AgentEvent, AgentEventOf, Reaction, SessionPlan } from "@/lib/domain/types";
import { ReplanRequest, SessionRequest } from "@/lib/domain/types";
import { PERSONAS } from "@/lib/personas";

import { collect, mockDeps } from "./agent-deps";
import { testCtx } from "./helpers";

/**
 * The quiz-phrase check is owned by the contract test (tests/contract/domain.test.ts).
 * It is a local constant there, so it is read from that file rather than copied:
 * one source of truth, and this test fails loudly if the constant moves.
 */
function contractQuizPattern(): RegExp {
  const source = readFileSync(join(process.cwd(), "tests/contract/domain.test.ts"), "utf8");
  const match = /const QUIZ = \/(.+)\/([a-z]*);/.exec(source);
  if (!match) throw new Error("QUIZ pattern not found in tests/contract/domain.test.ts");
  return new RegExp(match[1], match[2]);
}

const QUIZ = contractQuizPattern();
const ofType = <K extends AgentEvent["type"]>(list: AgentEvent[], type: K) => list.filter((e): e is AgentEventOf<K> => e.type === type);
const texts = (plan: SessionPlan) => plan.steps.flatMap((s) => [s.prompt, s.promptTranslation ?? "", ...s.followUps]);

describe("mock outputs are invitational, never a memory quiz (contract QUIZ check)", () => {
  it("the pattern is the contract's and catches quiz phrasing", () => {
    expect(QUIZ.test("Do you remember this song?")).toBe(true);
    expect(QUIZ.test("Tell me about it, if you like.")).toBe(false);
  });

  it("every hand-written fixture prompt and follow-up", () => {
    for (const fixture of Object.values(PERSONA_FIXTURES)) {
      const templates = [fixture.opening, fixture.closing, fixture.calm, ...Object.values(fixture.steps)];
      for (const t of templates) for (const text of [t.prompt, t.translation, ...t.followUps]) expect(text).not.toMatch(QUIZ);
    }
    for (const lang of Object.values(GENERIC_TEXT)) for (const t of Object.values(lang)) expect(t.prompt).not.toMatch(QUIZ);
  });

  const custom = { notes: "Custom notes, long enough to pass.", birthYear: 1950, birthPlace: "Lyon", sessionLanguage: "fr" };
  const people = [...PERSONAS.map((p) => [p.slug, p.input] as const), ["custom", custom] as const];

  it.each(people)("%s: grounded plan and every replan reaction", async (_slug, person) => {
    const events = await collect(runSession(mockDeps(), SessionRequest.parse({ person }), testCtx()));
    const plan = ofType(events, "plan")[0].plan;
    const anchors = ofType(events, "anchors")[0].anchors;
    for (const text of texts(plan)) expect(text).not.toMatch(QUIZ);

    for (const reaction of ["lit_up", "neutral", "upset"] as Reaction[]) {
      for (const step of plan.steps.slice(0, -1)) {
        const req = ReplanRequest.parse({ plan, anchors, stepId: step.id, reaction });
        const replanned = ofType(await collect(runReplan(mockDeps(), req, testCtx())), "plan")[0].plan;
        for (const text of texts(replanned)) expect(text).not.toMatch(QUIZ);
      }
    }
  });
});
