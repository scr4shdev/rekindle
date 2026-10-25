/**
 * UI strings in the caregiver language. English is the source of truth: its
 * shape defines the `Messages` type. Every registered dictionary must satisfy
 * `Messages` in full, so a missing key is a typecheck error rather than a
 * silent English fallback at runtime. A locale that intentionally keeps a key
 * in English (brand terms, licence strings) still declares it explicitly with
 * the English value and a one-line comment. To add a locale, create
 * `src/i18n/<tag>.ts` exporting a `Messages` object with every key present,
 * and register it in `DICTIONARIES`. Prompts spoken to the person come from
 * the agent, never from here.
 *
 * This module is server-safe: it only exports pure data and the `getMessages`
 * lookup. React tree plumbing (<MessagesProvider>, useMessages) lives in
 * `@/i18n/provider` so this file can be imported from server components.
 */
import { en } from "@/i18n/en";
import { it } from "@/i18n/it";
import { fr } from "@/i18n/fr";

// `MessagesProvider` and `useMessages` live in a "use client" module; see
// `@/i18n/provider`. Client components can import them from this entry too.

type Widen<T> = T extends string
  ? string
  : T extends (...args: infer A) => string
    ? (...args: A) => string
    : T extends readonly (infer U)[]
      ? readonly Widen<U>[]
      : { [K in keyof T]: Widen<T[K]> };

export type Messages = Widen<typeof en>;

/**
 * Registered caregiver-language dictionaries. Each value is typed as
 * `Messages` (not `Partial<Messages>`), so a translator who misses a key
 * fails typecheck instead of silently shipping an English fallback.
 */
const DICTIONARIES: Record<string, Messages> = { it, fr };

/** Languages with a UI dictionary. */
export const UI_LANGUAGES = ["en", ...Object.keys(DICTIONARIES)];

const cache = new Map<string, Messages>();

/** Dictionary for a BCP 47 tag ("fr-BE" falls back to "fr", then to English). */
export function getMessages(lang?: string): Messages {
  const tag = lang?.toLowerCase() ?? "en";
  const hit = cache.get(tag);
  if (hit) return hit;
  const base = tag.split("-")[0];
  const messages: Messages = DICTIONARIES[tag] ?? DICTIONARIES[base] ?? (en as Messages);
  cache.set(tag, messages);
  return messages;
}

