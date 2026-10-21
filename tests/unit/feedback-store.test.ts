/**
 * feedback-store: client-side session note-back loop. These tests cover the
 * pure helpers (hash, summarize, clip) and the storage round-trip against a
 * minimal in-memory localStorage shim.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  KEEP_RECENT_SESSIONS,
  NOTE_MAX,
  SUMMARY_MAX,
  loadLatestFeedback,
  personKeyFromDisplayName,
  saveFeedback,
  summarizeFeedback,
  type FeedbackEntry,
} from "@/lib/feedback-store";

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string) {
    return this.map.has(k) ? (this.map.get(k) as string) : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
}

const originalLocalStorage = globalThis.localStorage;

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  if (originalLocalStorage) {
    Object.defineProperty(globalThis, "localStorage", { value: originalLocalStorage, configurable: true, writable: true });
  }
  vi.restoreAllMocks();
});

describe("personKeyFromDisplayName", () => {
  it("returns null for empty or whitespace-only names", async () => {
    expect(await personKeyFromDisplayName("")).toBeNull();
    expect(await personKeyFromDisplayName("   ")).toBeNull();
    expect(await personKeyFromDisplayName(undefined)).toBeNull();
    expect(await personKeyFromDisplayName(null)).toBeNull();
  });

  it("normalises whitespace and case so the same person maps to the same key", async () => {
    const a = await personKeyFromDisplayName(" Nonna Maria ");
    const b = await personKeyFromDisplayName("nonna maria");
    expect(a).not.toBeNull();
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("summarizeFeedback", () => {
  it("joins sparked, walked away, and did-not-land groups in a lowercase sentence", () => {
    const now = new Date().toISOString();
    const entries: FeedbackEntry[] = [
      { stepId: "s1", stepLabel: "the showband record", reaction: "sparked", note: null, savedAt: now },
      { stepId: "s2", stepLabel: "the taste step", reaction: "walked_away", note: null, savedAt: now },
    ];
    const line = summarizeFeedback(entries);
    expect(line).toBe("last time sparked on the showband record, and walked away during the taste step");
    expect(line).not.toMatch(/[A-Z]/);
    expect(line).not.toContain("—");
  });

  it("returns empty when no reactions are set", () => {
    const now = new Date().toISOString();
    expect(summarizeFeedback([{ stepId: "s1", stepLabel: "x", reaction: null, note: "note", savedAt: now }])).toBe("");
  });

  it("caps summaries at SUMMARY_MAX characters", () => {
    const now = new Date().toISOString();
    const entries: FeedbackEntry[] = Array.from({ length: 20 }, (_, i) => ({
      stepId: `s${i}`,
      stepLabel: `anchor number ${i} with a reasonably long label`,
      reaction: "sparked" as const,
      note: null,
      savedAt: now,
    }));
    const line = summarizeFeedback(entries);
    expect(line.length).toBeLessThanOrEqual(SUMMARY_MAX);
  });
});

describe("saveFeedback and loadLatestFeedback", () => {
  it("clips notes to NOTE_MAX and keeps only the three most recent sessions", async () => {
    const key = await personKeyFromDisplayName("Nonna Maria");
    expect(key).not.toBeNull();
    const longNote = "x".repeat(NOTE_MAX + 50);
    for (let i = 0; i < KEEP_RECENT_SESSIONS + 2; i++) {
      saveFeedback(key, `run-${i}`, [
        { stepId: `step-${i}`, stepLabel: `label ${i}`, reaction: "sparked", note: longNote, savedAt: "" },
      ]);
      // Slight stagger so the ISO timestamps order deterministically.
      await new Promise((r) => setTimeout(r, 5));
    }
    const latest = loadLatestFeedback(key);
    expect(latest).not.toBeNull();
    expect(latest?.entries[0].note?.length).toBe(NOTE_MAX);
    expect(latest?.runId).toBe(`run-${KEEP_RECENT_SESSIONS + 1}`);
    // Keeping only KEEP_RECENT_SESSIONS: there is no older runId we rotated out.
    const stored = globalThis.localStorage.getItem(`rekindle:feedback:${key}`) ?? "[]";
    const parsed = JSON.parse(stored) as { runId: string }[];
    expect(parsed).toHaveLength(KEEP_RECENT_SESSIONS);
    expect(parsed.find((s) => s.runId === "run-0")).toBeUndefined();
  });

  it("is a silent no-op when the person key is null (empty name)", () => {
    saveFeedback(null, "run-1", [{ stepId: "s1", stepLabel: "x", reaction: "sparked", note: null, savedAt: "" }]);
    expect(loadLatestFeedback(null)).toBeNull();
  });

  it("never throws when localStorage.setItem throws (quota, Safari private)", async () => {
    const key = await personKeyFromDisplayName("Nonna Maria");
    const throwing = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceeded");
      },
      removeItem: () => {},
      clear: () => {},
    };
    Object.defineProperty(globalThis, "localStorage", { value: throwing, configurable: true, writable: true });
    expect(() =>
      saveFeedback(key, "run-1", [{ stepId: "s1", stepLabel: "x", reaction: "sparked", note: null, savedAt: "" }]),
    ).not.toThrow();
    expect(loadLatestFeedback(key)).toBeNull();
  });
});
