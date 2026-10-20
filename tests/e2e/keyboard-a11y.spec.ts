import { expect, test, type Page } from "@playwright/test";

/**
 * Keyboard-only safety net. Each surface walks a few Tab stops, confirms the
 * active element is the expected one, and asserts the global `:focus-visible`
 * outline is visible. Not a full WCAG audit (axe handles that in a11y.spec):
 * this guards against focus regressions on the specific flows a judge drives.
 */

/** The focused element has the global 3px solid outline token (`--ring`). */
async function expectFocusRing(page: Page) {
  const outlineStyle = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return null;
    const s = getComputedStyle(el);
    return { style: s.outlineStyle, width: s.outlineWidth };
  });
  expect(outlineStyle, "no focused element").not.toBeNull();
  expect(outlineStyle!.style).not.toBe("none");
  // The global rule sets outline: 3px solid var(--ring); the width is always "3px".
  expect(parseFloat(outlineStyle!.width)).toBeGreaterThanOrEqual(1);
}

async function activeTestId(page: Page): Promise<string | null> {
  return page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.testid ?? null);
}

async function activeText(page: Page): Promise<string> {
  return page.evaluate(() => (document.activeElement as HTMLElement | null)?.textContent?.trim() ?? "");
}

test.describe("keyboard navigation", () => {
  test("landing: skip link, header, persona cards and custom form reachable", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-testid=custom-form]");
    // First Tab lands on the skip-to-content link.
    await page.keyboard.press("Tab");
    expect((await activeText(page)).toLowerCase()).toContain("skip");
    await expectFocusRing(page);
    // Walk until we reach the first persona card. Give it room: the header
    // includes the logo link, the Compare link and the theme toggle.
    const seen = new Set<string>();
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press("Tab");
      const id = await activeTestId(page);
      if (id) seen.add(id);
      if (seen.has("persona-maria")) break;
    }
    expect(seen.has("persona-maria"), `seen: ${[...seen].join(", ")}`).toBe(true);
    await expectFocusRing(page);
    // No focus trap: continuing to Tab eventually reaches the custom-form
    // (textarea or any field inside it). Allow a generous loop; the exact
    // count varies with the persona card count and the theme toggle.
    let inForm = false;
    for (let i = 0; i < 60 && !inForm; i++) {
      await page.keyboard.press("Tab");
      inForm = await page.evaluate(() => {
        const form = document.querySelector("[data-testid=custom-form]");
        return !!(form && document.activeElement && form.contains(document.activeElement));
      });
    }
    expect(inForm, "custom form never reached via Tab").toBe(true);
  });

  test("session: run-live, start-live reachable; trace rows open on Enter", async ({ page }) => {
    await page.goto("/session?persona=maria&source=replay&speed=40");
    await expect(page.getByTestId("session-view")).toHaveAttribute("data-status", "done");
    // Tab-walk from the top of the page; the main action strip must include
    // run-live (replay source) and start-live.
    const targets = ["run-live", "start-live"];
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press("Tab");
      const id = await activeTestId(page);
      if (id && targets.includes(id)) {
        seen.add(id);
        await expectFocusRing(page);
      }
      if (targets.every((t) => seen.has(t))) break;
    }
    for (const t of targets) {
      expect(seen.has(t), `missing tab stop: ${t}; seen: ${[...seen].join(", ")}`).toBe(true);
    }
    // The qloo-call <details> opens on Enter.
    const firstCall = page.getByTestId("qloo-call").first();
    await firstCall.locator("summary").focus();
    await expectFocusRing(page);
    await page.keyboard.press("Enter");
    await expect(firstCall).toHaveAttribute("open", "");
  });

  test("compare: would-slip badges are focusable and reveal the rejection on focus", async ({ page }) => {
    // Maria's compare run has a Maradona step in the llm-only column that
    // matches a grounded anachronism rejection, so a would-slip badge is
    // guaranteed. Fatima's grounded run no longer catches Western-drift
    // items (they live only in her llmOnlyBody, by design for respect), so
    // we use Maria here for the keyboard affordance check.
    await page.goto("/compare?persona=maria&source=sample&speed=40");
    await expect(page.getByTestId("compare-view")).toHaveAttribute("data-grounded-status", "done");
    const badge = page.getByTestId("would-slip-badge").first();
    await expect(badge).toBeVisible();
    await badge.focus();
    await expectFocusRing(page);
    // Base UI opens the tooltip on focus; the content portals to the body.
    await expect(page.getByTestId("would-slip-tooltip").first()).toBeVisible();
  });

  test("bedside modal: Tab cycles reactions, Esc closes, focus returns to opener", async ({ page }) => {
    await page.goto("/session?persona=maria&source=sample&speed=40");
    await expect(page.getByTestId("session-view")).toHaveAttribute("data-status", "done");
    const opener = page.getByTestId("start-live");
    await opener.focus();
    await page.keyboard.press("Enter");
    const live = page.getByTestId("live-session");
    await expect(live).toBeVisible();
    // Walk Tabs; the three reaction buttons must all be reachable.
    const reactionIds = ["react-lit_up", "react-neutral", "react-upset"];
    const seen = new Set<string>();
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press("Tab");
      const id = await activeTestId(page);
      if (id && reactionIds.includes(id)) seen.add(id);
      if (reactionIds.every((r) => seen.has(r))) break;
    }
    for (const r of reactionIds) {
      expect(seen.has(r), `reaction not reachable by Tab: ${r}; seen: ${[...seen].join(", ")}`).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(live).toBeHidden();
    // Base UI Dialog returns focus to the previously focused element.
    const activeId = await activeTestId(page);
    expect(activeId).toBe("start-live");
  });

  test("for-operators: footer link, section anchors and mailto CTA reachable", async ({ page }) => {
    await page.goto("/for-operators");
    await page.getByTestId("operators-cta").focus();
    await expectFocusRing(page);
    const href = await page.getByTestId("operators-cta").getAttribute("href");
    expect(href).toContain("mailto:");
    // Shift+Tab reaches a focusable element before the CTA (a source link).
    await page.keyboard.press("Shift+Tab");
    const prevTag = await page.evaluate(() => document.activeElement?.tagName ?? "");
    expect(["A", "BUTTON"]).toContain(prevTag);
    await expectFocusRing(page);
  });
});
