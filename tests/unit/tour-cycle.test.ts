/**
 * Pure cycle logic for the judge tour: URL-param parsing, persona ordering,
 * wrap-around after the last persona, and caption-label selection from a
 * SessionView snapshot. The React player wraps these functions; the state
 * machine itself is deterministic and tested here without a DOM.
 */
import { describe, expect, it } from "vitest";

import { viewFromEvents } from "@/components/session/view-state";
import {
  TOUR_PERSONAS,
  captionLabel,
  initialIndex,
  nextIndex,
  parseAutoplay,
  parseSpeed,
  parseStartPersona,
} from "@/components/tour/tour-cycle";
import { en } from "@/i18n/en";
import type { AgentEvent, AgentPhase } from "@/lib/domain/types";

const PHASE_LABELS: Record<AgentPhase, string> = en.trace.phases;

describe("TOUR_PERSONAS", () => {
  it("lists Maria, Fatima, Seamus in that order (Maria first)", () => {
    expect([...TOUR_PERSONAS]).toEqual(["maria", "fatima", "seamus"]);
  });
});

describe("parseStartPersona", () => {
  it("accepts the three recorded slugs case-insensitively", () => {
    expect(parseStartPersona("maria")).toBe("maria");
    expect(parseStartPersona("FATIMA")).toBe("fatima");
    expect(parseStartPersona("Seamus")).toBe("seamus");
  });
  it("falls back to Maria for unknown or missing slugs", () => {
    expect(parseStartPersona(null)).toBe("maria");
    expect(parseStartPersona("")).toBe("maria");
    expect(parseStartPersona("judge")).toBe("maria");
  });
});

describe("parseSpeed", () => {
  it("parses positive numbers and defaults to 1", () => {
    expect(parseSpeed("2")).toBe(2);
    expect(parseSpeed("0.5")).toBe(0.5);
    expect(parseSpeed(null)).toBe(1);
    expect(parseSpeed("")).toBe(1);
  });
  it("rejects non-positive and non-finite values", () => {
    expect(parseSpeed("0")).toBe(1);
    expect(parseSpeed("-3")).toBe(1);
    expect(parseSpeed("fast")).toBe(1);
    expect(parseSpeed("Infinity")).toBe(1);
  });
});

describe("parseAutoplay", () => {
  it("defaults to true when the param is missing", () => {
    expect(parseAutoplay(null)).toBe(true);
    expect(parseAutoplay(undefined)).toBe(true);
  });
  it("treats '0' and 'false' as disabled", () => {
    expect(parseAutoplay("0")).toBe(false);
    expect(parseAutoplay("false")).toBe(false);
    expect(parseAutoplay("FALSE")).toBe(false);
  });
  it("treats any other value as enabled", () => {
    expect(parseAutoplay("1")).toBe(true);
    expect(parseAutoplay("yes")).toBe(true);
    expect(parseAutoplay("")).toBe(true);
  });
});

describe("initialIndex", () => {
  it("maps each persona to its position in the cycle", () => {
    expect(initialIndex("maria")).toBe(0);
    expect(initialIndex("fatima")).toBe(1);
    expect(initialIndex("seamus")).toBe(2);
  });
});

describe("nextIndex", () => {
  it("advances through the cycle and wraps back to Maria", () => {
    expect(nextIndex(0)).toBe(1);
    expect(nextIndex(1)).toBe(2);
    expect(nextIndex(2)).toBe(0);
  });
});

describe("captionLabel", () => {
  const base = {
    phase: (phase: AgentPhase, status: "started" | "completed" | "skipped"): AgentEvent => ({
      seq: 0,
      t: 0,
      type: "phase",
      phase,
      status,
      message: "",
    }),
  };

  it("falls back to the parse label before any phase has started", () => {
    const view = viewFromEvents([]);
    expect(captionLabel(view, PHASE_LABELS)).toBe(PHASE_LABELS.parse);
  });

  it("picks the latest started phase", () => {
    const events: AgentEvent[] = [
      { ...base.phase("parse", "started"), seq: 0, t: 0 },
      { ...base.phase("parse", "completed"), seq: 1, t: 100 },
      { ...base.phase("verify", "started"), seq: 2, t: 200 },
    ];
    const view = viewFromEvents(events);
    expect(captionLabel(view, PHASE_LABELS)).toBe(PHASE_LABELS.verify);
  });

  it("falls back to the latest completed phase when nothing is in progress", () => {
    const events: AgentEvent[] = [
      { ...base.phase("parse", "started"), seq: 0, t: 0 },
      { ...base.phase("parse", "completed"), seq: 1, t: 100 },
      { ...base.phase("verify", "completed"), seq: 2, t: 200 },
    ];
    const view = viewFromEvents(events);
    expect(captionLabel(view, PHASE_LABELS)).toBe(PHASE_LABELS.verify);
  });

  it("uses the compose label when the planner is composing", () => {
    const events: AgentEvent[] = [
      { ...base.phase("compose", "started"), seq: 0, t: 0 },
    ];
    const view = viewFromEvents(events);
    expect(captionLabel(view, PHASE_LABELS)).toBe(PHASE_LABELS.compose);
  });
});
