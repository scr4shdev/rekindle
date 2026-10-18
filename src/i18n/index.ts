/**
 * UI strings in the caregiver language. English is the source of truth and the
 * fallback. To add a language, create `src/i18n/<tag>.ts` exporting a
 * `PartialMessages` object (any subset of the English keys) and register it in
 * DICTIONARIES; missing keys fall back to English. Prompts spoken to the person
 * come from the agent, never from here.
 */
import { en } from "@/i18n/en";

type Widen<T> = T extends string
  ? string
  : T extends (...args: infer A) => string
    ? (...args: A) => string
    : T extends readonly (infer U)[]
      ? readonly Widen<U>[]
      : { [K in keyof T]: Widen<T[K]> };

export type Messages = Widen<typeof en>;

type DeepPartial<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly unknown[]
    ? T
    : T extends object
      ? { [K in keyof T]?: DeepPartial<T[K]> }
      : T;

export type PartialMessages = DeepPartial<Messages>;

/** Registered caregiver-language dictionaries (e.g. `it`, `fr`), merged over English. */
const DICTIONARIES: Record<string, PartialMessages> = {};

/** Languages with a UI dictionary. */
export const UI_LANGUAGES = ["en", ...Object.keys(DICTIONARIES)];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function merge<T>(base: T, override: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(override)) return (override ?? base) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value !== undefined) out[key] = merge((base as Record<string, unknown>)[key], value);
  }
  return out as T;
}

const cache = new Map<string, Messages>();

/** Dictionary for a BCP 47 tag ("fr-BE" falls back to "fr", then to English). */
export function getMessages(lang?: string): Messages {
  const tag = lang?.toLowerCase() ?? "en";
  const hit = cache.get(tag);
  if (hit) return hit;
  const base = tag.split("-")[0];
  const override = DICTIONARIES[tag] ?? DICTIONARIES[base];
  const messages: Messages = override ? merge<Messages>(en, override) : en;
  cache.set(tag, messages);
  return messages;
}
