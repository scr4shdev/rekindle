/**
 * VERIFY helper: pick the Qloo search result that is the same entity as the
 * candidate, or none. Used only when no result has the exact normalized name.
 * Input holds only public cultural data (not sensitive) and the structured
 * cultural anchors of the person (place, era window, languages, cultural
 * background) so the LLM can disambiguate same-name entities (e.g. Cheb
 * Khaled vs DJ Khaled) by preferring the one whose metadata fits the person.
 */
import { z } from "zod";

import type { PromptDefinition } from "@/lib/ports/llm";
import { dataBlock, DATA_NOTICE, lines } from "@/lib/prompts/shared";

export const ID = "match-entity";
export const VERSION = "1.1.0";

export interface MatchEntityInput {
  candidate: { name: string; domain: string; qlooType: string; year?: number };
  /** Cultural anchors used to prefer a culturally-fitting candidate. */
  origin: {
    primaryPlace?: string;
    primaryCountryCode?: string;
    culturalBackground?: string;
    languages: string[];
    formativeWindow: { startYear: number; endYear: number };
  };
  results: Array<{
    index: number;
    name: string;
    type: string;
    year?: number;
    bornYear?: number;
    disambiguation?: string;
    description?: string;
  }>;
}

export const schema = z.object({
  matchIndex: z.number().int().describe("Index of the result that is the same real-world entity, or -1 if none is."),
  confidence: z.enum(["high", "medium", "low"]),
  reason: z.string().describe("One short sentence in English."),
});
export type MatchEntityOutput = z.infer<typeof schema>;

export const system = lines(
  "You match a proposed cultural item to search results from a taste-graph database.",
  [
    "Rules:",
    "- Choose a result only if it is the same real-world entity: spelling variants, transliterations, articles and accents may differ.",
    "- Different people, remakes, tribute acts or same-name entities from another era are NOT matches.",
    "- If unsure, return -1. A wrong match is worse than no match.",
  ].join("\n"),
  [
    "Disambiguation precedence (apply in order when several results share a name):",
    "1. Era fit: given the person's formative window [a, b], prefer a candidate whose work_period or date_of_birth sits within [a - 20, b + 10]; the description often names the era.",
    "2. Place and culture fit: prefer a candidate whose description, disambiguation or language ties to the person's primary place, country or cultural background. A candidate from a visibly different culture (e.g. an American rapper for a Moroccan person's reminiscence) is NOT a match.",
    "3. Language fit: prefer a candidate who performs or works in one of the person's languages.",
    "4. Never pick a candidate just because it is the most popular, the most recent, or the first in the list. If none of the candidates clearly fits the person's era AND culture, return -1. A rejection is better than a culturally wrong match.",
  ].join("\n"),
  DATA_NOTICE,
);

export function render(input: MatchEntityInput): string {
  return lines(
    dataBlock("candidate", input.candidate),
    dataBlock("origin", input.origin),
    dataBlock("results", input.results),
    "Return the match as JSON.",
  );
}

export const matchEntityPrompt: PromptDefinition<MatchEntityInput, MatchEntityOutput> = {
  id: ID,
  version: VERSION,
  system,
  render,
  schema,
};
