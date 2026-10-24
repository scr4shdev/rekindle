/**
 * Hand-off of a composed plan from the /session tab to the /plan/[id]/print
 * tab, both running in the same browser session. sessionStorage is cloned to
 * target="_blank" child tabs on same-origin links, so the print tab reads
 * what the session tab wrote without a network trip or a second agent run.
 *
 * The payload is intentionally lean: the plan the sheet renders, plus the
 * two anchors fields the header shows (birthYear and callbacks), plus the
 * display name and language tags. No raw notes, no caregiver free text
 * beyond what the composed plan itself contains.
 *
 * Reads and writes are wrapped in try/catch: SSR has no window, private
 * browsing can throw on access, and quota failures must stay silent.
 */
import type { SessionPlan } from "@/lib/domain/types";

export const PRINT_HANDOFF_KEY_PREFIX = "rekindle:lastPlan:";

export interface StoredPrintPlan {
  plan: SessionPlan;
  anchors: {
    birthYear: number;
    callbacks?: string[];
  };
  displayName?: string;
  sessionLanguage: string;
  caregiverLanguage: string;
}

function storageOrNull(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function keyFor(id: string): string {
  return `${PRINT_HANDOFF_KEY_PREFIX}${id}`;
}

function isStoredPrintPlan(value: unknown): value is StoredPrintPlan {
  if (!value || typeof value !== "object") return false;
  const outer = value as Record<string, unknown>;
  if (!outer.plan || typeof outer.plan !== "object") return false;
  const plan = outer.plan as Record<string, unknown>;
  if (!Array.isArray(plan.steps) || plan.steps.length === 0) return false;
  if (typeof plan.title !== "string") return false;
  if (!outer.anchors || typeof outer.anchors !== "object") return false;
  const anchors = outer.anchors as Record<string, unknown>;
  if (typeof anchors.birthYear !== "number") return false;
  if (typeof outer.sessionLanguage !== "string") return false;
  if (typeof outer.caregiverLanguage !== "string") return false;
  return true;
}

/**
 * Read the plan stored for `id` in this tab's sessionStorage. Returns
 * undefined for SSR, empty storage, parse errors, or an unexpected shape.
 * `storage` is injectable for tests.
 */
export function readStoredPlan(id: string, storage: Storage | null = storageOrNull()): StoredPrintPlan | undefined {
  if (!storage) return undefined;
  try {
    const raw = storage.getItem(keyFor(id));
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    return isStoredPrintPlan(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Persist the plan for `id` in this tab's sessionStorage. Silent on SSR,
 * quota failures, or any access error. `storage` is injectable for tests.
 */
export function writeStoredPlan(
  id: string,
  payload: StoredPrintPlan,
  storage: Storage | null = storageOrNull(),
): void {
  if (!storage) return;
  try {
    storage.setItem(keyFor(id), JSON.stringify(payload));
  } catch {
    // Quota exceeded, private browsing, or similar: leave the previous value.
  }
}
