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
 * Hex sha256 of the given string. Uses Web Crypto when available (secure
 * contexts: HTTPS, localhost). Falls back to a small pure-JS SHA-256 so the
 * demo also works over plain HTTP on the hackathon LAN host. The two
 * implementations produce identical output for the same input.
 */
async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const digest = await subtle.digest("SHA-256", bytes);
    return toHex(new Uint8Array(digest));
  }
  return toHex(sha256Bytes(bytes));
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

// SHA-256 round constants.
const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const;

function ror(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

/**
 * Pure-JS SHA-256. Covers the hackathon demo path when Web Crypto is not
 * exposed (plain HTTP origin on the LAN host). Not meant as a general
 * crypto primitive: the key is a local cache key, nothing more.
 */
function sha256Bytes(msg: Uint8Array): Uint8Array {
  const bitLen = msg.length * 8;
  const padLen = ((msg.length + 9 + 63) >> 6) << 6;
  const padded = new Uint8Array(padLen);
  padded.set(msg);
  padded[msg.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padLen - 4, bitLen >>> 0, false);
  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w = new Array<number>(64);
  for (let i = 0; i < padLen; i += 64) {
    for (let t = 0; t < 16; t++) w[t] = dv.getUint32(i + t * 4, false);
    for (let t = 16; t < 64; t++) {
      const s0 = ror(w[t - 15], 7) ^ ror(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = ror(w[t - 2], 17) ^ ror(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let t = 0; t < 64; t++) {
      const S1 = ror(e, 6) ^ ror(e, 11) ^ ror(e, 25);
      const ch = (e & f) ^ (~e & g);
      const T1 = (h + S1 + ch + K[t] + w[t]) >>> 0;
      const S0 = ror(a, 2) ^ ror(a, 13) ^ ror(a, 22);
      const mj = (a & b) ^ (a & c) ^ (b & c);
      const T2 = (S0 + mj) >>> 0;
      h = g; g = f; f = e;
      e = (d + T1) >>> 0;
      d = c; c = b; b = a;
      a = (T1 + T2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  const out = new Uint8Array(32);
  const outDv = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) outDv.setUint32(i * 4, H[i], false);
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
