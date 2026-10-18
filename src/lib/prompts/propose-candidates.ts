/**
 * PROPOSE: anchors -> era- and locale-plausible cultural candidates per
 * domain, each with a Qloo type hint to verify against.
 */
import { z } from "zod";

import { QLOO_ENTITY_TYPES, TASTE_DOMAINS } from "@/lib/domain/types";
import type { Anchors, TasteDomain } from "@/lib/domain/types";
import type { PromptDefinition } from "@/lib/ports/llm";
import { dataBlock, DATA_NOTICE, lines, ROLE } from "@/lib/prompts/shared";

export const ID = "propose-candidates";
export const VERSION = "1.0.0";

export interface ProposeCandidatesInput {
  anchors: Anchors;
  maxPerDomain: number;
  /** Domains with the Qloo types that can ground them (empty: not groundable). */
  domains: Array<{ domain: TasteDomain; qlooTypes: string[] }>;
  caregiverLanguage: string;
}

export const schema = z.object({
  candidates: z
    .array(
      z.object({
        domain: z.enum(TASTE_DOMAINS),
        name: z.string().describe("The canonical public name (original title for films and songs' artists)."),
        qlooType: z.enum([...QLOO_ENTITY_TYPES, "none"]).describe("One of the domain's Qloo types, or 'none' if not groundable."),
        year: z.number().int().describe("Year it was released or most popular for this person; 0 if not applicable."),
        rationale: z.string().describe("One short sentence in the caregiver language: why it fits this person."),
      }),
    )
    .max(60),
  notes: z.array(z.string()).max(3).describe("Up to 3 short narration lines in the caregiver language."),
});
export type ProposeCandidatesOutput = z.infer<typeof schema>;

export const system = lines(
  ROLE,
  "Task: propose concrete cultural items from the person's formative years and places, to be checked against Qloo's taste graph.",
  [
    "Rules:",
    "- Start from the stated loves, then add what was popular where they lived during their formative window.",
    "- Era: prefer items released or popular inside the formative window; a stated love is always included.",
    "- Locale: local and national culture of their places first, then international stars that reached that place.",
    "- Respect sensitivities: do not propose items centred on a topic marked 'avoid'.",
    "- For music propose artists (Qloo has no songs). Athletes and actors are persons. Dishes stay qlooType 'none'.",
    "- Use real, verifiable names only. At most maxPerDomain items per domain.",
  ].join("\n"),
  DATA_NOTICE,
);

export function render(input: ProposeCandidatesInput): string {
  return lines(
    dataBlock("anchors", input.anchors),
    dataBlock("domains", input.domains),
    dataBlock("limits", { maxPerDomain: input.maxPerDomain, caregiverLanguage: input.caregiverLanguage }),
    "Return the candidates as JSON matching the schema.",
  );
}

export const proposeCandidatesPrompt: PromptDefinition<ProposeCandidatesInput, ProposeCandidatesOutput> = {
  id: ID,
  version: VERSION,
  system,
  render,
  schema,
};
