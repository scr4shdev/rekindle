/**
 * VERIFY helper: pick the Qloo search result that is the same entity as the
 * candidate, or none. Used only when no result has the exact normalized name.
 * Input holds only public cultural data (not sensitive).
 */
import { z } from "zod";

import type { PromptDefinition } from "@/lib/ports/llm";
import { dataBlock, DATA_NOTICE, lines } from "@/lib/prompts/shared";

export const ID = "match-entity";
export const VERSION = "1.0.0";

export interface MatchEntityInput {
  candidate: { name: string; domain: string; qlooType: string; year?: number };
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
  DATA_NOTICE,
);

export function render(input: MatchEntityInput): string {
  return lines(dataBlock("candidate", input.candidate), dataBlock("results", input.results), "Return the match as JSON.");
}

export const matchEntityPrompt: PromptDefinition<MatchEntityInput, MatchEntityOutput> = {
  id: ID,
  version: VERSION,
  system,
  render,
  schema,
};
