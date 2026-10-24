/**
 * CRITIQUE helper: for a person with non-Western cultural origin, classify
 * Qloo-affinity entities as cultural_match | cultural_mismatch | unclear.
 *
 * Rationale (F2, driven by the Qloo live probe): seeding Qloo insights from
 * non-Western seeds like Oum Kalthoum / Faten Hamama tends to extrapolate to
 * Hollywood or mainstream Western entities (worldwide bands, US political
 * figures, The Godfather). The structural country-tag filter cannot catch
 * this because many entities lack reliable country tags. The LLM makes the
 * semantic judgment here, with the person's culture spelled out as data.
 *
 * Input is derived from anchors (sensitive, not cached remotely).
 */
import { z } from "zod";

import type { PromptDefinition } from "@/lib/ports/llm";
import { dataBlock, DATA_NOTICE, lines, ROLE } from "@/lib/prompts/shared";

export const ID = "cultural-check";
export const VERSION = "1.1.0";

export const CULTURAL_VERDICTS = ["cultural_match", "cultural_mismatch", "unclear"] as const;
export type CulturalVerdict = (typeof CULTURAL_VERDICTS)[number];

export interface CulturalCheckItem {
  ref: string;
  name: string;
  domain: string;
  /** Short description if Qloo had one; often names a country or language. */
  description?: string;
  /** Names of the Qloo seeds this entity was derived from (expand phase). */
  seeds?: string[];
}

export interface CulturalCheckInput {
  /** The person's cultural origin, spelled plainly (country, cultural background, places). */
  origin: {
    primaryCountryCode?: string;
    primaryPlace?: string;
    culturalBackground?: string;
    languages: string[];
  };
  items: CulturalCheckItem[];
}

export const schema = z.object({
  verdicts: z.array(
    z.object({
      ref: z.string().describe("The item's ref, copied exactly."),
      verdict: z.enum(CULTURAL_VERDICTS),
      reason: z
        .string()
        .describe(
          "One short English sentence. For cultural_mismatch, name both sides: the seed's culture and the entity's apparent origin.",
        ),
    }),
  ),
});
export type CulturalCheckOutput = z.infer<typeof schema>;

export const system = lines(
  ROLE,
  "Task: judge whether cross-domain discoveries from a taste graph are culturally plausible for a person whose cultural origin is NOT mainstream Western.",
  [
    "For each item, classify:",
    "- cultural_match: the entity belongs to, or circulated in, the person's culture, language or diaspora during their lifetime.",
    "- cultural_mismatch: the entity is a clear Western/mainstream extrapolation that would not realistically have reached this person (e.g. a seed of Oum Kalthoum expanding to Hollywood actors or US politicians is a mismatch).",
    "- unclear: not enough information to decide; err on this when the entity is globally known AND plausibly familiar across cultures.",
    "Prefer cultural_mismatch when the seeds are strongly tied to one culture and the entity is strongly tied to a different, dominant culture.",
    "Give one verdict per item, in input order. Reasons must stay specific and under one sentence.",
  ].join("\n"),
  DATA_NOTICE,
);

export function render(input: CulturalCheckInput): string {
  return lines(
    dataBlock("origin", input.origin),
    dataBlock("items", input.items),
    "Return the verdicts as JSON.",
  );
}

export const culturalCheckPrompt: PromptDefinition<CulturalCheckInput, CulturalCheckOutput> = {
  id: ID,
  version: VERSION,
  system,
  render,
  schema,
};
