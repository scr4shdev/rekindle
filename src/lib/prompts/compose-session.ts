/**
 * COMPOSE: kept materials -> a timed, guided session in the person's
 * language, with translations and caregiver tips. Provenance and entities are
 * attached in code from `materialRef`, never decided by the model.
 */
import { z } from "zod";

import { LifePhaseLabel, StepKind } from "@/lib/domain/types";
import type { Anchors, DementiaStage } from "@/lib/domain/types";
import type { PromptDefinition } from "@/lib/ports/llm";
import { AGGREGATE_GUIDANCE, dataBlock, DATA_NOTICE, DEMENTIA_FRIENDLY_GUIDANCE, lines, ROLE } from "@/lib/prompts/shared";

export const ID = "compose-session";
export const VERSION = "1.4.1";

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
  /** Life phase this material is anchored in, when known. */
  lifePhase?: z.infer<typeof LifePhaseLabel>;
}

export interface ComposeSessionInput {
  /** How to address the person (from the caregiver), if given. */
  displayName?: string;
  anchors: Anchors;
  sessionLanguage: string;
  caregiverLanguage: string;
  sessionMinutes: number;
  maxSteps: number;
  /**
   * Optional dementia-stage hint from the caregiver. Shapes pace, step count,
   * music weight and the kinds of prompts allowed. Absent means use the
   * early-stage defaults.
   */
  stage?: DementiaStage;
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
  lifePhase: z
    .enum([...LifePhaseLabel.options, "none"])
    .default("none")
    .describe("Which of the person's life phases this step is anchored in. Must match the material's phase when the material has one. 'none' only for opening and closing."),
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
  [
    "Music primacy (required):",
    "At least two steps must be music (kind 'listen' or 'move'). Music has the strongest evidence base for engagement in dementia, especially where speech recall has declined (Abraha 2017 BMJ Open umbrella review: pooled SMD -0.49 for agitation and -0.64 for anxiety; Säkämö 2014: singing lifted memory, thinking and orientation in mild-dementia under-80s). Prefer music steps as anchors around which other steps hang. Do not stack them all adjacent; distribute them across the session so the person gets a music anchor near the start, in the middle and near the close.",
  ].join("\n"),
  [
    "Stage tuning (follow the stage carried in `session.stage`, when present):",
    "- early (default when stage is absent): 6 to 8 steps, 2 to 3 minutes each, at least two music steps, follow-ups allowed. Evidence is strongest in mild dementia (Cochrane 2018 reminiscence review, Säkämö 2014 singing RCT), so the plan can span the fuller arc: a greeting, five or six anchors, a close.",
    "- mid: 5 to 6 steps, 2 to 3 minutes each, at least three music or sensory anchors, keep follow-ups to one short line and drop them when the material already carries the moment. Attention narrows at mid-stage, so lean on music, familiar images and smells, and let the caregiver sit in each anchor longer rather than reaching for a sixth step.",
    "- late: 4 to 5 steps, about 90 seconds each (round to 1 or 2 minutes in `durationMin`), at least four music or sensory anchors, no follow-ups, no complex questions. In late-stage dementia speech recall often fails and NICE NG97's wellbeing bracket, not the cognition bracket, is what applies: prompts must be yes-no or presence invitations ('Shall we listen together?', 'This is Oum Kalthoum.'), never 'Who was that?' or 'Do you remember?'. Keep every prompt short and present-tense.",
  ].join("\n"),
  [
    "Lifespan coverage (required when anchors.lifePhases is non-empty):",
    "- Across the plan's body steps (not counting opening and closing), use materials from at least three different life phases. Aim for one childhood or youth step, one early_adulthood or mid_life step, and the remainder wherever the materials sit most richly. The reminiscence bump stays the richest zone; it should not be the only one.",
    "- Set each body step's lifePhase to its material's lifePhase. If the material has none, pick the phase whose window the material's year falls in. For opening and closing, set lifePhase to 'none'.",
    "- Every body step (listen, look, talk, taste, move) must carry a lifePhase from the person's lifePhases list; only opening and closing may be 'none'.",
    "- When writing the caregiverTip, name the phase in human terms ('from her childhood home', 'from his twenties in Cork', 'from the years she raised her children'); do not emit the raw enum tag.",
  ].join("\n"),
  [
    "Specificity (required, every step except opening and closing):",
    "- Every prompt names the specific grounded material it is built on (the entity's name as given in materials), and at least one specific year or decade drawn from the person's formative window.",
    "- Every caregiverTip gives a concrete reason this material fits THIS person: name the material and a specific place or decade from the anchors. No generic reassurance ('they may enjoy this'), no boilerplate ('if they seem to enjoy it...'), no hedging about 'exposure' or 'background in general'.",
    "- Forbidden register (never emit any variant): 'selections reflect X's Y background', 'international exposure', 'cultural heritage shaped them', 'this piece speaks to their roots', 'a classic from their era'. These sentences hide the fact that no concrete anchor was used.",
    "- Required register: name the entity, name a year or decade, tie it to a place from anchors. Example for a 1954-born Moroccan who grew up in Rabat: prompt 'Khaled's 1980s rai still lifts a room. What does this song bring up for you?'; caregiverTip 'Cheb Khaled was everywhere in the Rabat of the 1980s; expect foot-tapping or humming along.' Example for a 1942-born Neapolitan: caregiverTip 'Carosone was the soundtrack of 1950s Naples; many families danced to this at home.'",
    "- Lifetime bounds (hard): never reference an entity, event, or person outside the person's lifetime bounds (anchors.lifetimeWindow). A song released after they died, a film from before they were born, a public figure born after them: none of these go in a prompt, follow-up or tip. The verify phase enforces this on grounded materials; the same rule applies to anything the compose step adds in prose.",
  ].join("\n"),
  [
    "Media hint (per step kind):",
    "- listen (music): \"Search '<Artist Title Year>' on YouTube\" or \"...on Spotify\". Both work for a song.",
    "- look at a photograph of a place or face: \"Search '<Place Year>' on Google Images\" or \"...on Wikimedia Commons\".",
    "- look at a film: \"Search '<Film Year>' on YouTube\" when a full film or clip is available; otherwise \"...on IMDb\" for a trailer or stills.",
    "- move (gentle movement to music): \"Search '<song or routine>' on YouTube\".",
    "- talk, opening, closing: omit mediaHint (empty string). The step either has no media to show or is a greeting/close.",
    "- taste: omit mediaHint unless a specific recipe or image is useful.",
    "- Never say 'search on YouTube' for a photograph. Pick the source that actually fits the step kind.",
    "- If the material already has an entity.imageUrl (surfaced by Qloo), the UI shows it directly; the mediaHint is the fallback.",
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
      stage: input.stage ?? "early",
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
