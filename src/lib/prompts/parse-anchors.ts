/**
 * PARSE: caregiver notes -> structured anchors. Input derives from notes, so
 * the agent calls it with `sensitive: true`.
 */
import { z } from "zod";

import { TASTE_DOMAINS } from "@/lib/domain/types";
import type { PromptDefinition } from "@/lib/ports/llm";
import { dataBlock, DATA_NOTICE, lines, ROLE } from "@/lib/prompts/shared";

export const ID = "parse-anchors";
export const VERSION = "1.0.0";

export interface ParseAnchorsInput {
  notes: string;
  birthYear?: number;
  birthPlace?: string;
  sessionLanguage: string;
  caregiverLanguage: string;
  currentYear: number;
  formativeAgeMin: number;
  formativeAgeMax: number;
}

export const schema = z.object({
  birthYear: z.number().int().describe("The stated birth year hint if given, else the best inference from the notes."),
  birthYearSource: z.enum(["stated", "inferred"]),
  places: z
    .array(
      z.object({
        name: z.string().describe("Public place name, city level or a well-known district (e.g. 'Naples', 'Cork')."),
        countryCode: z.string().describe("ISO 3166-1 alpha-2 code, or an empty string if unknown."),
        role: z.enum(["birthplace", "childhood", "youth", "adulthood", "other"]),
        fromYear: z.number().int().describe("0 if unknown."),
        toYear: z.number().int().describe("0 if unknown."),
      }),
    )
    .max(8),
  languages: z
    .array(z.object({ tag: z.string().describe("BCP 47 tag, e.g. 'it', 'nap', 'ar-MA'."), name: z.string() }))
    .min(1)
    .max(5)
    .describe("Languages the person speaks, most comfortable first."),
  loves: z
    .array(
      z.object({
        label: z.string(),
        domain: z.enum([...TASTE_DOMAINS, "other"]),
        source: z.enum(["stated", "inferred"]),
      }),
    )
    .max(20),
  sensitivities: z
    .array(
      z.object({
        topic: z.string().describe("Topic to avoid or handle gently, without private names where possible."),
        reason: z.string().describe("Short reason, in the caregiver language."),
        severity: z.enum(["avoid", "handle_gently"]),
      }),
    )
    .max(10),
  occupation: z.string().describe("Empty string if unknown."),
  culturalBackground: z.string().describe("Short; empty string if unknown."),
  summary: z.string().describe("One neutral paragraph (max 80 words) for later planning steps."),
  privateNames: z
    .array(z.string())
    .max(20)
    .describe("Names of private people in the notes (the person, family, friends, carers). Never public figures."),
  notes: z.array(z.string()).max(3).describe("Up to 3 short lines for the caregiver, in the caregiver language."),
});
export type ParseAnchorsOutput = z.infer<typeof schema>;

export const system = lines(
  ROLE,
  "Task: read the caregiver's notes about one person and extract structured anchors for planning a reminiscence activity.",
  [
    "Rules:",
    "- Extract only what the notes state or clearly imply; mark inferences as 'inferred'.",
    "- Loves: concrete cultural things (artists, songs' artists, films, teams, dishes, places, crafts). Use the closest domain, 'other' if none fits.",
    "- Sensitivities: anything the caregiver says to avoid or that may cause distress (bereavement, war, illness, separation, religion or diet rules).",
    "- privateNames: list every private person's name you see, so it can be kept out of external lookups.",
    "- Places: public names only, never street addresses.",
    "- Write reasons and notes in the caregiver language given in the input.",
  ].join("\n"),
  DATA_NOTICE,
);

export function render(input: ParseAnchorsInput): string {
  return lines(
    dataBlock("context", {
      currentYear: input.currentYear,
      formativeYears: `ages ${input.formativeAgeMin}-${input.formativeAgeMax}`,
      statedBirthYear: input.birthYear ?? null,
      statedBirthPlace: input.birthPlace ?? null,
      sessionLanguage: input.sessionLanguage,
      caregiverLanguage: input.caregiverLanguage,
    }),
    dataBlock("caregiver_notes", input.notes),
    "Return the anchors as JSON matching the schema.",
  );
}

export const parseAnchorsPrompt: PromptDefinition<ParseAnchorsInput, ParseAnchorsOutput> = {
  id: ID,
  version: VERSION,
  system,
  render,
  schema,
};
