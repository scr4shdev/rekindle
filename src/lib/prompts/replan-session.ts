/**
 * REPLAN: rewrite the upcoming steps after a reaction. Past steps are never
 * sent for rewriting; kept steps are referenced by id and reused unchanged.
 */
import { z } from "zod";

import type { Anchors, Reaction } from "@/lib/domain/types";
import type { PromptDefinition } from "@/lib/ports/llm";
import type { ComposeMaterial } from "@/lib/prompts/compose-session";
import { ModelStep } from "@/lib/prompts/compose-session";
import { AGGREGATE_GUIDANCE, dataBlock, DATA_NOTICE, DEMENTIA_FRIENDLY_GUIDANCE, lines, ROLE } from "@/lib/prompts/shared";

export const ID = "replan-session";
export const VERSION = "1.0.0";

export interface ReplanStepSummary {
  id: string;
  title: string;
  kind: string;
  domain?: string;
  entityName?: string;
  durationMin: number;
}

export interface ReplanSessionInput {
  anchors: Anchors;
  sessionLanguage: string;
  caregiverLanguage: string;
  reaction: Reaction;
  reactedStep: ReplanStepSummary;
  /** Earlier reactions, oldest first. */
  history: Array<{ stepTitle: string; reaction: Reaction }>;
  /** Optional caregiver note about the reaction. */
  note?: string;
  done: ReplanStepSummary[];
  upcoming: ReplanStepSummary[];
  /** Extra materials (e.g. Qloo affinity from the step that lit them up). */
  newMaterials: ComposeMaterial[];
  minutesRemaining: number;
  maxUpcoming: number;
}

export const schema = z.object({
  message: z.string().describe("One short line for the caregiver, in the caregiver language, saying what comes next."),
  notes: z.array(z.string()).max(3).describe("Up to 3 short reasoning lines in the caregiver language."),
  upcoming: z
    .array(
      z.object({
        keepStepId: z.string().describe("Id of an existing upcoming step to keep unchanged, or empty for a new step."),
        step: ModelStep.describe("The new step. Ignored when keepStepId is set (fill with minimal values)."),
      }),
    )
    .max(15)
    .describe("The new list of upcoming steps, in order."),
  removed: z
    .array(
      z.object({
        stepId: z.string(),
        kind: z.enum(["emotional_risk", "low_relevance", "duplicate"]),
        reason: z.string().describe("Short reason in the caregiver language."),
      }),
    )
    .max(15),
});
export type ReplanSessionOutput = z.infer<typeof schema>;

export const system = lines(
  ROLE,
  "Task: the caregiver just recorded the person's reaction to a step. Adapt only the steps that have not happened yet.",
  [
    "How to adapt:",
    "- lit_up: lean into that thread next (same artist, era or domain); new materials from Qloo affinity may help.",
    "- neutral: change domain or modality for the next step (e.g. from talking to listening or moving).",
    "- upset: next, a calming and familiar step (a gentle known song, slow breathing with music, holding a familiar object);",
    "  remove upcoming steps on a related risky theme, and say why in 'removed'.",
    "- Keep the closing step last. Keep unchanged steps by id. Stay within minutesRemaining and maxUpcoming.",
  ].join("\n"),
  DEMENTIA_FRIENDLY_GUIDANCE,
  AGGREGATE_GUIDANCE,
  DATA_NOTICE,
);

export function render(input: ReplanSessionInput): string {
  return lines(
    dataBlock("reaction", {
      reaction: input.reaction,
      reactedStep: input.reactedStep,
      history: input.history,
      caregiverNote: input.note ?? null,
    }),
    dataBlock("anchors", input.anchors),
    dataBlock("done_steps", input.done),
    dataBlock("upcoming_steps", input.upcoming),
    dataBlock("new_materials", input.newMaterials),
    dataBlock("limits", {
      sessionLanguage: input.sessionLanguage,
      caregiverLanguage: input.caregiverLanguage,
      minutesRemaining: input.minutesRemaining,
      maxUpcoming: input.maxUpcoming,
    }),
    "Return the adapted upcoming steps as JSON matching the schema.",
  );
}

export const replanSessionPrompt: PromptDefinition<ReplanSessionInput, ReplanSessionOutput> = {
  id: ID,
  version: VERSION,
  system,
  render,
  schema,
};
