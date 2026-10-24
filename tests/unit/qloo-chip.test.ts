/**
 * E1: the Qloo chip renders only when a grounded body step carries aggregate
 * `qlooProvenance` with usable context tokens. Everything else (opening or
 * closing steps, llm-only steps, missing provenance, zero tokens) must return
 * undefined so the step card keeps its current look.
 */
import { describe, expect, it } from "vitest";

import { qlooChipSpec } from "@/components/session/qloo-chip";
import type { SessionStep, VerifiedEntity } from "@/lib/domain/types";

const eraTemplate = (year: number) => `${year} era`;

const anchorEntity: VerifiedEntity = {
  id: "ve_1",
  qlooId: "qloo-abc",
  name: "Oum Kalthoum",
  domain: "music",
  qlooType: "urn:entity:artist",
  provenance: "llm-proposed-qloo-verified",
  candidateId: "c_1",
};

const baseStep: SessionStep = {
  id: "s_1",
  order: 1,
  kind: "listen",
  title: "Oum Kalthoum",
  prompt: "Let us listen together.",
  followUps: [],
  durationMin: 3,
  provenance: "qloo-grounded",
};

describe("qlooChipSpec", () => {
  it("returns undefined when the step carries no qlooProvenance", () => {
    expect(qlooChipSpec(baseStep, eraTemplate)).toBeUndefined();
  });

  it("returns undefined for llm-only steps even if provenance is present (should never happen)", () => {
    const step: SessionStep = {
      ...baseStep,
      provenance: "llm-only",
      qlooProvenance: { kind: "verified", seeds: [], tags: ["Jazz"] },
    };
    expect(qlooChipSpec(step, eraTemplate)).toBeUndefined();
  });

  it("returns undefined for opening and closing steps", () => {
    const opening: SessionStep = { ...baseStep, kind: "opening", qlooProvenance: { kind: "verified", seeds: [], tags: ["Jazz"] } };
    const closing: SessionStep = { ...baseStep, kind: "closing", qlooProvenance: { kind: "verified", seeds: [], tags: ["Jazz"] } };
    expect(qlooChipSpec(opening, eraTemplate)).toBeUndefined();
    expect(qlooChipSpec(closing, eraTemplate)).toBeUndefined();
  });

  it("verified anchor with a release year opens the context with the era token", () => {
    const step: SessionStep = {
      ...baseStep,
      entity: { ...anchorEntity, releaseYear: 1972 },
      qlooProvenance: { kind: "verified", seeds: [], tags: ["Umm Diyaf cuisine"] },
    };
    expect(qlooChipSpec(step, eraTemplate)).toEqual({
      variant: "confirmed",
      tokens: ["1972 era", "Umm Diyaf cuisine"],
    });
  });

  it("verified anchor without a year falls back to tag tokens only (deduped by whitespace)", () => {
    const step: SessionStep = {
      ...baseStep,
      entity: anchorEntity,
      qlooProvenance: { kind: "verified", seeds: [], tags: ["  Jazz  ", "Egypt"] },
    };
    expect(qlooChipSpec(step, eraTemplate)).toEqual({
      variant: "confirmed",
      tokens: ["Jazz", "Egypt"],
    });
  });

  it("expanded anchor prefers seed names and caps at two tokens", () => {
    const step: SessionStep = {
      ...baseStep,
      entity: { ...anchorEntity, provenance: "qloo-affinity", seedQlooIds: [] },
      qlooProvenance: { kind: "expanded", seeds: ["Oum Kalthoum", "Casablanca radio", "A third"], tags: ["Jazz"] },
    };
    expect(qlooChipSpec(step, eraTemplate)).toEqual({
      variant: "linked",
      tokens: ["Oum Kalthoum", "Casablanca radio"],
    });
  });

  it("expanded anchor falls back to tags when no seed names resolved", () => {
    const step: SessionStep = {
      ...baseStep,
      entity: { ...anchorEntity, provenance: "qloo-affinity", seedQlooIds: [] },
      qlooProvenance: { kind: "expanded", seeds: [], tags: ["Classical Arabic", "Egypt"] },
    };
    expect(qlooChipSpec(step, eraTemplate)).toEqual({
      variant: "linked",
      tokens: ["Classical Arabic", "Egypt"],
    });
  });

  it("returns undefined when every seed and tag is empty", () => {
    const step: SessionStep = {
      ...baseStep,
      qlooProvenance: { kind: "expanded", seeds: ["  ", ""], tags: ["   "] },
    };
    expect(qlooChipSpec(step, eraTemplate)).toBeUndefined();
  });

  it("is deterministic: same input gives the same spec on repeated calls", () => {
    const step: SessionStep = {
      ...baseStep,
      entity: { ...anchorEntity, releaseYear: 1964 },
      qlooProvenance: { kind: "verified", seeds: [], tags: ["Classical Arabic"] },
    };
    const a = qlooChipSpec(step, eraTemplate);
    const b = qlooChipSpec(step, eraTemplate);
    expect(a).toEqual(b);
  });
});
