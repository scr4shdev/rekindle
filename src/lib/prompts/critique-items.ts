/**
 * CRITIQUE: judge every item against era, locale and sensitivities, with
 * reasons in the caregiver language. Input contains anchors (sensitive).
 */
import { z } from "zod";

import type { Anchors } from "@/lib/domain/types";
import type { PromptDefinition } from "@/lib/ports/llm";
import { AGGREGATE_GUIDANCE, dataBlock, DATA_NOTICE, lines, ROLE } from "@/lib/prompts/shared";

export const ID = "critique-items";
export const VERSION = "1.0.0";

export interface CritiqueItem {
  ref: string;
  label: string;
  domain: string;
  /** Release or peak year when known. */
  year?: number;
  /** Birth year for people and artists, when known. */
  bornYear?: number;
  description?: string;
  source: "qloo-verified" | "qloo-affinity" | "llm-idea";
}

export interface CritiqueItemsInput {
  anchors: Anchors;
  caregiverLanguage: string;
  items: CritiqueItem[];
}

export const CRITIQUE_KINDS = ["none", "anachronism", "wrong_locale", "emotional_risk", "duplicate", "low_relevance"] as const;

export const schema = z.object({
  verdicts: z.array(
    z.object({
      ref: z.string().describe("The item's ref, copied exactly."),
      keep: z.boolean(),
      kind: z.enum(CRITIQUE_KINDS).describe("'none' when kept; otherwise the main reason to drop it."),
      reason: z.string().describe("One short sentence in the caregiver language, with the concrete fact (e.g. a year)."),
    }),
  ),
  notes: z.array(z.string()).max(3).describe("Up to 3 short narration lines in the caregiver language."),
});
export type CritiqueItemsOutput = z.infer<typeof schema>;

export const system = lines(
  ROLE,
  "Task: review candidate items for one person's reminiscence activity and drop the ones that do not belong.",
  [
    "Drop an item when:",
    "- anachronism: it became known clearly after the formative window ended (or long before it began) and is not a stated love;",
    "- wrong_locale: it would not have reached the person's places or culture at the time;",
    "- emotional_risk: it touches a sensitivity marked 'avoid', or a religious or dietary rule in the notes (e.g. alcohol for someone who avoids it);",
    "- duplicate: same thing as another item (keep the better one);",
    "- low_relevance: only a weak link to this person.",
    "Keep stated loves unless they clash with a sensitivity. Give one verdict per item, in input order.",
  ].join("\n"),
  AGGREGATE_GUIDANCE,
  DATA_NOTICE,
);

export function render(input: CritiqueItemsInput): string {
  return lines(
    dataBlock("anchors", input.anchors),
    dataBlock("items", input.items),
    `Caregiver language: ${input.caregiverLanguage}. Return the verdicts as JSON.`,
  );
}

export const critiqueItemsPrompt: PromptDefinition<CritiqueItemsInput, CritiqueItemsOutput> = {
  id: ID,
  version: VERSION,
  system,
  render,
  schema,
};
