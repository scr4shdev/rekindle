/**
 * PROPOSE: anchors -> era- and locale-plausible cultural candidates per
 * domain, each with a Qloo type hint to verify against.
 */
import { z } from "zod";

import { LifePhaseLabel, QLOO_ENTITY_TYPES, TASTE_DOMAINS } from "@/lib/domain/types";
import type { Anchors, TasteDomain } from "@/lib/domain/types";
import type { PromptDefinition } from "@/lib/ports/llm";
import { dataBlock, DATA_NOTICE, lines, ROLE } from "@/lib/prompts/shared";

export const ID = "propose-candidates";
export const VERSION = "1.2.1";

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
        lifePhase: z
          .enum([...LifePhaseLabel.options, "none"])
          .describe("Which of the person's life phases (from the lifePhases list) this item is anchored in. Emit 'none' when unclear or when the input has no lifePhases."),
        rationale: z.string().describe("One short sentence in the caregiver language: why it fits this person."),
      }),
    )
    .max(60),
  notes: z.array(z.string()).max(3).describe("Up to 3 short narration lines in the caregiver language."),
});
export type ProposeCandidatesOutput = z.infer<typeof schema>;

export const system = lines(
  ROLE,
  "Task: propose concrete cultural items from across the person's life (childhood through later life) in their places, to be checked against Qloo's taste graph.",
  [
    "Rules:",
    "- Start from the stated loves, then add what was popular where they lived.",
    "- Lifespan coverage, not just formative years: aim for at least one strong candidate per non-empty life phase in the anchors.lifePhases list (childhood lullabies and games, youth-first-love music, early-parenting television, mid-life public figures, songs they played for their own children). The formative window is the richest zone, not the only one.",
    "- Tag every candidate with its lifePhase: pick the phase whose window the year falls in (phase start inclusive, phase end inclusive). If the item spans two phases, pick the earlier one. Use 'none' only when no phase in the input fits.",
    "- Year must be the year the item was most important for THIS person (first encountered, peak popularity in their city, release year of a landmark album), NOT the person's birth year. Items with no meaningful year (dishes, lifelong rituals) stay year 0.",
    "- Example for a 1950-born Moroccan whose childhood is 1950-1958 and youth is 1958-1971: Oum Kalthoum, year 1964, lifePhase youth; Fairuz, year 1960, lifePhase youth; Fès medina, year 0, lifePhase childhood; Nass El Ghiwane, year 1972, lifePhase early_adulthood. One item per phase at minimum, drawn from the person's culture, so childhood, youth and early_adulthood each have an anchor.",
    "- Locale: local and national culture of their places first, then international stars that reached that place.",
    "- Respect sensitivities: do not propose items centred on a topic marked 'avoid'.",
    "- For music propose artists (Qloo has no songs). Athletes and actors are persons. Dishes stay qlooType 'none'.",
    "- Use real, verifiable names only. At most maxPerDomain items per domain.",
    "- Names must be unambiguous in the person's culture: use the full performing name the person's audience would recognise ('Cheb Khaled', not 'Khaled'; 'Oum Kalthoum', not 'Oum'). When several famous people share a short name, choose the one from the person's place and era and spell it so the Qloo search points at that one; do not emit a bare short name that could resolve to a different, better-known Western namesake.",
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
