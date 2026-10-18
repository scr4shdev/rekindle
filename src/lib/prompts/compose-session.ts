/**
 * COMPOSE: kept materials -> a timed, guided session in the person's
 * language, with translations and caregiver tips. Provenance and entities are
 * attached in code from `materialRef`, never decided by the model.
 */
import { z } from "zod";

import { StepKind } from "@/lib/domain/types";
import type { Anchors } from "@/lib/domain/types";
import type { PromptDefinition } from "@/lib/ports/llm";
import { AGGREGATE_GUIDANCE, dataBlock, DATA_NOTICE, DEMENTIA_FRIENDLY_GUIDANCE, lines, ROLE } from "@/lib/prompts/shared";

export const ID = "compose-session";
export const VERSION = "1.0.0";

/** English source of the non-medical disclaimer; the model translates it to the caregiver language. */
export const DISCLAIMER_EN =
  "Rekindle suggests reminiscence activities. It is not medical advice or therapy. Follow the person's lead, " +
  "stop if they seem uncomfortable, and check with their care team about anything health-related.";

export interface ComposeMaterial {
  ref: string;
  label: string;
  domain: string;
  year?: number;
  description?: string;
  /** "qloo-verified" (exists in Qloo), "qloo-affinity" (aggregate discovery) or "llm-idea" (unverified). */
  source: "qloo-verified" | "qloo-affinity" | "llm-idea";
  /** For affinity items: names of the seeds it came from. */
  becauseOf?: string[];
}

export interface ComposeSessionInput {
  /** How to address the person (from the caregiver), if given. */
  displayName?: string;
  anchors: Anchors;
  sessionLanguage: string;
  caregiverLanguage: string;
  sessionMinutes: number;
  maxSteps: number;
  disclaimerEnglish: string;
  materials: ComposeMaterial[];
}

/** One step as the model writes it. Shared with replan-session. */
export const ModelStep = z.object({
  kind: StepKind,
  title: z.string().describe("Short title in the caregiver language."),
  materialRef: z.string().describe("The ref of the material this step is built on, or an empty string."),
  prompt: z.string().describe("What the caregiver says aloud, in the session language. Open-ended, never a quiz."),
  promptTranslation: z.string().describe("The prompt in the caregiver language; empty if both languages are the same."),
  followUps: z.array(z.string()).max(3).describe("Gentle optional follow-ups in the session language."),
  caregiverTip: z.string().describe("One practical tip in the caregiver language."),
  durationMin: z.number().int().describe("Minutes for this step (1-10)."),
  mediaHint: z.string().describe("How to find the song, film still or photo (e.g. a search phrase); empty if none."),
});
export type ModelStep = z.infer<typeof ModelStep>;

export const schema = z.object({
  title: z.string().describe("Warm session title in the session language."),
  disclaimer: z.string().describe("The disclaimer translated faithfully into the caregiver language."),
  steps: z.array(ModelStep).min(3).max(15),
});
export type ComposeSessionOutput = z.infer<typeof schema>;

export const system = lines(
  ROLE,
  "Task: compose a gentle, timed reminiscence session from the provided materials only.",
  [
    "Structure:",
    "- Start with an 'opening' (greeting, orientation, no question to answer) and end with a 'closing' (thanks, warmth).",
    "- In between, alternate kinds: listen (music), look (film still, photo, object), talk, taste or smell (only if food is in the notes), move (clap, sway from the chair).",
    "- Prefer qloo-verified materials and stated loves; use at most one or two qloo-affinity items, framed as a gentle try.",
    "- Each step uses at most one material via materialRef; only refs from the materials list are allowed.",
    "- Durations are whole minutes and should add up to the session length.",
    "- Respect every sensitivity: 'avoid' topics never appear; 'handle_gently' topics get a caregiver tip.",
    "- For tastes: remind the caregiver to check swallowing and diet guidance.",
  ].join("\n"),
  DEMENTIA_FRIENDLY_GUIDANCE,
  AGGREGATE_GUIDANCE,
  DATA_NOTICE,
);

export function render(input: ComposeSessionInput): string {
  return lines(
    dataBlock("session", {
      addressAs: input.displayName ?? null,
      sessionLanguage: input.sessionLanguage,
      caregiverLanguage: input.caregiverLanguage,
      sessionMinutes: input.sessionMinutes,
      maxSteps: input.maxSteps,
    }),
    dataBlock("anchors", input.anchors),
    dataBlock("materials", input.materials),
    dataBlock("disclaimer_english", input.disclaimerEnglish),
    "Return the session as JSON matching the schema.",
  );
}

export const composeSessionPrompt: PromptDefinition<ComposeSessionInput, ComposeSessionOutput> = {
  id: ID,
  version: VERSION,
  system,
  render,
  schema,
};
