/**
 * Print hand-off helpers: the session tab writes a lean plan payload into
 * sessionStorage; the print tab reads it back without running the agent.
 * Empty, corrupt, or malformed storage must never throw.
 */
import { describe, expect, it } from "vitest";

import { PRINT_HANDOFF_KEY_PREFIX, readStoredPlan, writeStoredPlan, type StoredPrintPlan } from "@/components/print/print-handoff";
import type { SessionPlan } from "@/lib/domain/types";

function fakeStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() { return store.size; },
    clear: () => store.clear(),
    getItem: (key) => (store.has(key) ? (store.get(key) ?? null) : null),
    key: (index) => Array.from(store.keys())[index] ?? null,
    removeItem: (key) => void store.delete(key),
    setItem: (key, value) => void store.set(key, String(value)),
  };
}

function samplePayload(): StoredPrintPlan {
  const plan = {
    id: "plan_1", title: "Twenty quiet minutes", language: "en", caregiverLanguage: "en",
    steps: [{ id: "s1", order: 1, title: "Welcome", kind: "opening", prompt: "Hello", durationMin: 2, provenance: "llm_only" }],
    totalMinutes: 20, mode: "grounded", disclaimer: "Not medical advice.", generatedAt: new Date().toISOString(),
    meta: { llmProvider: "mock", llmModel: "mock", qlooMode: "unused", promptVersions: {}, revision: 0 },
  } as unknown as SessionPlan;
  return { plan, anchors: { birthYear: 1946, callbacks: ["I heard she loved Johnny Hallyday"] }, displayName: "Marc", sessionLanguage: "fr", caregiverLanguage: "en" };
}

describe("print-handoff", () => {
  it("returns undefined when nothing is stored for that id", () => {
    const storage = fakeStorage();
    expect(readStoredPlan("custom", storage)).toBeUndefined();
  });

  it("round-trips a payload a print tab can render without a stream", () => {
    const storage = fakeStorage();
    const payload = samplePayload();
    writeStoredPlan("custom", payload, storage);
    const roundTripped = readStoredPlan("custom", storage);
    expect(roundTripped).toBeDefined();
    expect(roundTripped?.plan.steps).toHaveLength(1);
    expect(roundTripped?.anchors.birthYear).toBe(1946);
    expect(roundTripped?.displayName).toBe("Marc");
    expect(roundTripped?.sessionLanguage).toBe("fr");
    expect(storage.getItem(`${PRINT_HANDOFF_KEY_PREFIX}custom`)).toBeTruthy();
  });

  it("isolates plans by id so personas do not shadow each other", () => {
    const storage = fakeStorage();
    writeStoredPlan("maria", samplePayload(), storage);
    expect(readStoredPlan("fatima", storage)).toBeUndefined();
    expect(readStoredPlan("maria", storage)).toBeDefined();
  });

  it("rejects corrupted JSON without throwing", () => {
    const storage = fakeStorage();
    storage.setItem(`${PRINT_HANDOFF_KEY_PREFIX}custom`, "{not json");
    expect(readStoredPlan("custom", storage)).toBeUndefined();
  });

  it("rejects a payload with the wrong shape", () => {
    const storage = fakeStorage();
    storage.setItem(`${PRINT_HANDOFF_KEY_PREFIX}custom`, JSON.stringify({ plan: { steps: [] } }));
    expect(readStoredPlan("custom", storage)).toBeUndefined();
  });

  it("swallows a storage write failure (quota, private browsing)", () => {
    const throwing: Storage = {
      ...fakeStorage(),
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(() => writeStoredPlan("custom", samplePayload(), throwing)).not.toThrow();
  });
});
