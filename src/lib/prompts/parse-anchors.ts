/**
 * PARSE: caregiver notes + "This is Me" structured fields -> structured
 * anchors. Input derives from caregiver-entered strings, so the agent calls it
 * with `sensitive: true`.
 */
import { z } from "zod";

import { TASTE_DOMAINS } from "@/lib/domain/types";
import type { PromptDefinition } from "@/lib/ports/llm";
import { dataBlock, DATA_NOTICE, lines, ROLE } from "@/lib/prompts/shared";

export const ID = "parse-anchors";
export const VERSION = "1.2.0";

export interface ParseAnchorsInput {
  /** Free-text notes blob. Falls back when structured fields are empty. */
  notes: string;
  birthYear?: number;
  birthPlace?: string;
  sessionLanguage: string;
  caregiverLanguage: string;
  currentYear: number;
  formativeAgeMin: number;
  formativeAgeMax: number;
  /** Alzheimer's Society "This is Me" structured fields. All optional. */
  culturalBackground?: string;
  keyLifeEvents?: string;
  calmingCues?: string;
  thingsToAvoid?: string;
  routines?: string;
  stage?: "early" | "mid" | "late";
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
    "- Input precedence: structured 'This is Me' fields (cultural_background, key_life_events, calming_cues, things_to_avoid, routines) are the primary signal when provided; the free-text 'notes' is a supplementary hint. When the two conflict, prefer the structured fields.",
    "- Extract only what the input states or clearly implies; mark inferences as 'inferred'.",
    "- Loves: concrete cultural things (artists, songs' artists, films, teams, dishes, places, crafts, communities a person belonged to). Prefer entries that appear in cultural_background, key_life_events, calming_cues or routines. Use the closest domain, 'other' if none fits.",
    "- Sensitivities: a topic is a sensitivity only when the caregiver explicitly places it under things_to_avoid, uses an avoidance verb for it ('do not mention', 'stays away from', 'triggers her', 'upsets him'), or the context makes clear it caused this person distress (bereavement, war, illness, separation, a specific person who hurt them). The topic itself does not decide: the caregiver's framing does.",
    "- A religious or community anchor (a church, mosque, temple, synagogue, Bible, Quran, Torah, mass, prayer, hymn, gospel, Pentecostal, Catholic, Baptist, Buddhist, Muslim, Jewish, Hindu, Sikh service, religious holiday) named inside cultural_background, key_life_events, calming_cues, or alongside stated loves is a POSITIVE anchor (a 'love'), not a sensitivity. It only becomes a sensitivity when the caregiver places it under things_to_avoid, uses an avoidance verb for it, or describes a specific painful experience tied to it ('she was excluded by the church she grew up in').",
    "- Worked example (religion as a stated anchor, not a trigger). cultural_background: 'Pentecostal church was his community for sixty years.' calming_cues: 'her Bible, gospel hymns.' things_to_avoid: '' (empty). CORRECT: add 'Pentecostal church community' and 'gospel hymns' and 'the Bible' to loves (domain 'other' or 'music' for hymns); do NOT add 'religion', 'Pentecostal' or 'the Bible' to sensitivities. INCORRECT: adding {topic: 'Pentecostal', severity: 'handle_gently'} or {topic: 'religion', severity: 'avoid'} based on the topic alone.",
    "- privateNames: list every private person's name you see, so it can be kept out of external lookups.",
    "- Places: public names only, never street addresses.",
    "- Write reasons and notes in the caregiver language given in the input.",
  ].join("\n"),
  DATA_NOTICE,
);

export function render(input: ParseAnchorsInput): string {
  const thisIsMe: Record<string, string> = {};
  if (input.culturalBackground) thisIsMe.cultural_background = input.culturalBackground;
  if (input.keyLifeEvents) thisIsMe.key_life_events = input.keyLifeEvents;
  if (input.calmingCues) thisIsMe.calming_cues = input.calmingCues;
  if (input.thingsToAvoid) thisIsMe.things_to_avoid = input.thingsToAvoid;
  if (input.routines) thisIsMe.routines = input.routines;
  if (input.stage) thisIsMe.stage = input.stage;

  const blocks = [
    dataBlock("context", {
      currentYear: input.currentYear,
      formativeYears: `ages ${input.formativeAgeMin}-${input.formativeAgeMax}`,
      statedBirthYear: input.birthYear ?? null,
      statedBirthPlace: input.birthPlace ?? null,
      sessionLanguage: input.sessionLanguage,
      caregiverLanguage: input.caregiverLanguage,
    }),
  ];
  if (Object.keys(thisIsMe).length > 0) {
    blocks.push(dataBlock("this_is_me", thisIsMe));
  }
  blocks.push(dataBlock("caregiver_notes", input.notes));
  blocks.push("Return the anchors as JSON matching the schema.");
  return lines(...blocks);
}

export const parseAnchorsPrompt: PromptDefinition<ParseAnchorsInput, ParseAnchorsOutput> = {
  id: ID,
  version: VERSION,
  system,
  render,
  schema,
};
