/**
 * UI strings. English is the source of truth; other caregiver languages
 * (it, fr) plug in as dictionaries with the same shape. Prompts spoken to the
 * person come from the agent, not from here.
 */
import { en } from "@/i18n/en";

type Widen<T> = T extends string
  ? string
  : T extends (...args: infer A) => string
    ? (...args: A) => string
    : { [K in keyof T]: Widen<T[K]> };

export type Messages = Widen<typeof en>;

const DICTIONARIES: Record<string, Messages> = { en };

/** Languages with a full UI dictionary. */
export const UI_LANGUAGES = Object.keys(DICTIONARIES);

/** Dictionary for a BCP 47 tag ("fr-BE" falls back to "fr", then to English). */
export function getMessages(lang?: string): Messages {
  const base = lang?.toLowerCase().split("-")[0];
  return (lang && DICTIONARIES[lang.toLowerCase()]) || (base && DICTIONARIES[base]) || en;
}
