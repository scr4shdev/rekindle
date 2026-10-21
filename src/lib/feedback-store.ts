/**
 * Session note-back store: per-person feedback kept in the caregiver's own
 * browser (localStorage), keyed by a sha256 of the trimmed, lowercased
 * displayName. The next intake for the same person prepends a short summary
 * so the agent can adjust.
 *
 * Pure client code: must not import adapters, agent, config, or the pino
 * logger (which is server-only). Never throws into the UI.
 *
 * Nothing persisted here reaches Qloo. The caller is responsible for
 * running the summary through the existing withPersonalDataGuard pattern
 * before any value derived from it leaves the client; the summary itself
 * mentions anchor labels and reactions only.
 */

export type FeedbackReaction = "sparked" | "did_not_land" | "walked_away";

export interface FeedbackEntry {
  /** Session step id. */
  stepId: string;
  /** Short, caregiver-friendly label of the step (title or anchor name). */
  stepLabel: string;
  /** The caregiver's one-tap reaction, or null if none chosen. */
  reaction: FeedbackReaction | null;
  /** Optional one-line note. Clipped to NOTE_MAX before persistence. */
  note: string | null;
  /** ISO timestamp written at save time. */
  savedAt: string;
}

export interface FeedbackSession {
  runId: string;
  savedAt: string;
  entries: FeedbackEntry[];
}

/** Hard limits (see task spec). */
export const NOTE_MAX = 160;
export const SUMMARY_MAX = 400;
export const KEEP_RECENT_SESSIONS = 3;

const KEY_PREFIX = "rekindle:feedback:";

/**
 * Hex sha256 of the given string via Web Crypto. Browser-only. The caller
 * handles the fact that this is async: localStorage is sync, so storing or
 * reading needs an awaited key.
 */
async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const view = new Uint8Array(digest);
  let out = "";
  for (let i = 0; i < view.length; i++) {
    out += view[i].toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * Hash a caregiver-provided displayName into a stable local key. Returns
 * null for empty names (we never persist anything in that case).
 */
export async function personKeyFromDisplayName(displayName: string | undefined | null): Promise<string | null> {
  const normalised = (displayName ?? "").trim().toLowerCase();
  if (normalised.length === 0) return null;
  try {
    return await sha256Hex(normalised);
  } catch {
    // Web Crypto unavailable (very old browsers, SSR). Silently no-op.
    return null;
  }
}

function storageKey(personKey: string): string {
  return `${KEY_PREFIX}${personKey}`;
}

function clipNote(note: string | null | undefined): string | null {
  if (note === null || note === undefined) return null;
  const trimmed = note.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length > NOTE_MAX ? trimmed.slice(0, NOTE_MAX) : trimmed;
}

function readSessions(personKey: string): FeedbackSession[] {
  try {
    const raw = globalThis.localStorage?.getItem(storageKey(personKey));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Light shape check (no zod here: W-UI client, keep it tiny).
    return parsed.filter(
      (s): s is FeedbackSession =>
        s && typeof s === "object" && typeof s.runId === "string" && typeof s.savedAt === "string" && Array.isArray(s.entries),
    );
  } catch {
    return [];
  }
}

function writeSessions(personKey: string, sessions: FeedbackSession[]): void {
  try {
    globalThis.localStorage?.setItem(storageKey(personKey), JSON.stringify(sessions));
  } catch {
    // Quota exceeded, Safari private, SSR, etc. Never surface to the UI.
  }
}

/**
 * Persist (or replace) the feedback for a single run. Keeps only the last
 * KEEP_RECENT_SESSIONS entries per person. No-ops when personKey is empty
 * or when localStorage is not available.
 */
export function saveFeedback(personKey: string | null, runId: string, entries: FeedbackEntry[]): void {
  if (!personKey || !runId) return;
  const now = new Date().toISOString();
  const clipped: FeedbackEntry[] = entries
    .map((e) => ({
      stepId: String(e.stepId ?? ""),
      stepLabel: String(e.stepLabel ?? "").slice(0, 160),
      reaction: e.reaction === "sparked" || e.reaction === "did_not_land" || e.reaction === "walked_away" ? e.reaction : null,
      note: clipNote(e.note),
      savedAt: now,
    }))
    .filter((e) => e.stepId.length > 0);
  const prior = readSessions(personKey).filter((s) => s.runId !== runId);
  const next: FeedbackSession[] = [...prior, { runId, savedAt: now, entries: clipped }];
  // Keep newest first for simpler loading.
  next.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
  writeSessions(personKey, next.slice(0, KEEP_RECENT_SESSIONS));
}

/** The most recent saved session for this person, or null. */
export function loadLatestFeedback(personKey: string | null): FeedbackSession | null {
  if (!personKey) return null;
  const sessions = readSessions(personKey);
  if (sessions.length === 0) return null;
  return sessions[0] ?? null;
}

/**
 * Build a short, lowercase, non-medical one-liner the caregiver and the
 * parse agent will both read. Mentions anchor labels and reactions only.
 * Capped at SUMMARY_MAX. Returns an empty string if nothing useful was
 * captured.
 */
export function summarizeFeedback(entries: FeedbackEntry[]): string {
  if (!Array.isArray(entries) || entries.length === 0) return "";
  const sparked: string[] = [];
  const didNotLand: string[] = [];
  const walkedAway: string[] = [];
  for (const entry of entries) {
    const label = (entry.stepLabel ?? "").trim();
    if (!label || !entry.reaction) continue;
    const soft = label.toLowerCase();
    if (entry.reaction === "sparked") sparked.push(soft);
    else if (entry.reaction === "did_not_land") didNotLand.push(soft);
    else if (entry.reaction === "walked_away") walkedAway.push(soft);
  }
  const parts: string[] = [];
  if (sparked.length > 0) parts.push(`sparked on ${joinList(sparked)}`);
  if (walkedAway.length > 0) parts.push(`walked away during ${joinList(walkedAway)}`);
  if (didNotLand.length > 0) parts.push(`did not land on ${joinList(didNotLand)}`);
  if (parts.length === 0) return "";
  const line = `last time ${parts.join(", and ")}`;
  // Clip; add an ellipsis-free truncation to stay well-formed.
  if (line.length <= SUMMARY_MAX) return line;
  return line.slice(0, SUMMARY_MAX).replace(/[,\s]+\S*$/, "");
}

function joinList(items: string[]): string {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  const head = items.slice(0, -1).join(", ");
  const tail = items[items.length - 1];
  return `${head}, and ${tail}`;
}
