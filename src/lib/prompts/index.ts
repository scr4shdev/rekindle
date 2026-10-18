import { composeSessionPrompt } from "@/lib/prompts/compose-session";
import { critiqueItemsPrompt } from "@/lib/prompts/critique-items";
import { matchEntityPrompt } from "@/lib/prompts/match-entity";
import { parseAnchorsPrompt } from "@/lib/prompts/parse-anchors";
import { proposeCandidatesPrompt } from "@/lib/prompts/propose-candidates";
import { replanSessionPrompt } from "@/lib/prompts/replan-session";

export { composeSessionPrompt, critiqueItemsPrompt, matchEntityPrompt, parseAnchorsPrompt, proposeCandidatesPrompt, replanSessionPrompt };

/** Every prompt module, keyed by id (for plan meta and the mock LLM). */
export const PROMPTS = {
  [parseAnchorsPrompt.id]: parseAnchorsPrompt,
  [proposeCandidatesPrompt.id]: proposeCandidatesPrompt,
  [matchEntityPrompt.id]: matchEntityPrompt,
  [critiqueItemsPrompt.id]: critiqueItemsPrompt,
  [composeSessionPrompt.id]: composeSessionPrompt,
  [replanSessionPrompt.id]: replanSessionPrompt,
} as const;
