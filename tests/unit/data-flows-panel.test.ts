/**
 * Small render test for the landing-page data-flows panel: it is a server
 * component, so `renderToStaticMarkup` on the returned element is enough.
 * The point of the test is to catch two regressions:
 *   1. A missing `dataFlows.*` key in any locale (silent English fallback).
 *   2. The panel copy drifting away from Rekindle's non-medical register,
 *      or starting to leak personal data labels.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DataFlowsPanel } from "@/components/landing/data-flows-panel";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import { it as itDict } from "@/i18n/it";

const BANNED = ["therapy", "treatment", "diagnosis", "patient", "thérapie", "patient·e", "paziente", "terapia"];

describe("DataFlowsPanel", () => {
  it("renders the heading, the three columns, and the chevron toggle (SSR)", () => {
    const html = renderToStaticMarkup(DataFlowsPanel());
    // Collapsible shell.
    expect(html).toContain("<details");
    expect(html).toContain("<summary");
    expect(html).toContain(en.dataFlows.heading);
    // All three column titles present.
    expect(html).toContain(en.dataFlows.qlooSeesTitle);
    expect(html).toContain(en.dataFlows.llmSeesTitle);
    expect(html).toContain(en.dataFlows.deviceOnlyTitle);
    // Testid hooks for e2e and manual QA.
    expect(html).toContain('data-testid="data-flows-panel"');
    expect(html).toContain('data-testid="data-flows-col-qloo"');
    expect(html).toContain('data-testid="data-flows-col-llm"');
    expect(html).toContain('data-testid="data-flows-col-device"');
  });

  it("defines dataFlows keys in every registered locale (no silent English fallback)", () => {
    const required = [
      "heading",
      "openLabel",
      "qlooSeesTitle",
      "qlooSeesBody",
      "llmSeesTitle",
      "llmSeesBody",
      "deviceOnlyTitle",
      "deviceOnlyBody",
    ] as const;
    for (const key of required) {
      expect(en.dataFlows[key], `en.dataFlows.${key}`).toBeTruthy();
      expect(fr.dataFlows?.[key], `fr.dataFlows.${key}`).toBeTruthy();
      expect(itDict.dataFlows?.[key], `it.dataFlows.${key}`).toBeTruthy();
    }
  });

  it("keeps the non-medical register in every locale", () => {
    const bodies = [
      ...Object.values(en.dataFlows),
      ...Object.values(fr.dataFlows ?? {}),
      ...Object.values(itDict.dataFlows ?? {}),
    ].filter((v): v is string => typeof v === "string");
    for (const body of bodies) {
      for (const word of BANNED) {
        expect(body.toLowerCase(), `banned word '${word}' in '${body}'`).not.toContain(word);
      }
      // AGENTS.md: no em dashes anywhere.
      expect(body, `em dash in '${body}'`).not.toMatch(/—/);
    }
  });
});
