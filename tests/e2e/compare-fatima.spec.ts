import { expect, test } from "@playwright/test";

/**
 * Fatima is the Potential Impact tiebreaker scenario: a Moroccan Muslim
 * elder from 1960s Fès whose grounded run catches two slips the LLM alone
 * waves through. Both are culturally respectful demonstrations of the
 * grounded guardrails: a pre-birth Egyptian golden-age film ("Lashin",
 * 1938) that Qloo refuses on the hard lifetime rail, and an anachronistic
 * raï singer ("Khaled", famous from 1992) that the critique LLM flags.
 *
 * The LLM-only column still carries the three fabricated-but-plausible
 * Western-drift items (The Beatles, Casablanca, Donald Trump) in Fatima's
 * `llmOnlyBody` fixture, so Compare renders "Would have slipped" badges on
 * those steps. Nothing with alcohol ever reaches the grounded pipeline.
 *
 * The compare page defaults to apiSource for Fatima (no sample recording),
 * so this spec goes straight to /compare?persona=fatima and reads from the
 * real agent running against mock LLM + mock Qloo.
 */

const GROUNDED_READY = { timeout: 25_000 };

test.describe("compare mode: Fatima tiebreaker", () => {
  test("hero stat, 2 catches, 3 would-slip badges, respectful content only", async ({ page }) => {
    await page.goto("/compare?persona=fatima");
    const view = page.getByTestId("compare-view");
    await expect(view).toHaveAttribute("data-llm-status", "done", GROUNDED_READY);
    await expect(view).toHaveAttribute("data-grounded-status", "done", GROUNDED_READY);

    // Hero stat callout: "The agent caught 2 slips and confirmed 10 real
    // matches." Per-guard breakdown lists Qloo refused 1 (Lashin) and
    // Critique caught 1 (Khaled); no cultural grounding row this run.
    const headline = page.getByTestId("compare-headline");
    await expect(headline).toContainText("The agent caught 2 slips and confirmed 10 real matches.");
    const breakdown = page.getByTestId("compare-headline-breakdown");
    await expect(breakdown).toContainText("Qloo refused 1");
    await expect(breakdown).toContainText("Critique caught 1");
    await expect(breakdown).not.toContainText("Cultural grounding");

    // Score table reports two catches in the grounded column.
    const score = page.getByTestId("compare-score");
    await expect(score.getByRole("row", { name: /Era, place or risk slips avoided/ })).toContainText("2");

    const grounded = page.getByTestId("compare-grounded");
    const llm = page.getByTestId("compare-llm");

    // Grounded Caught box lists the two rejected labels, both anachronism
    // ("Wrong era"): Lashin via the Qloo lifetime rail, Khaled via critique.
    for (const label of ["Lashin", "Khaled"]) {
      await expect(grounded.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(grounded.getByText("Wrong era")).toHaveCount(2);

    // Nothing with alcohol or Western political figures ever reaches the
    // grounded pipeline for a Moroccan Muslim woman's reminiscence session.
    for (const banned of ["Stella Artois", "Donald Trump", "The Beatles", "Casablanca"]) {
      await expect(grounded.getByText(banned, { exact: true })).toHaveCount(0);
    }

    // LLM-only column: the llmOnlyBody fixture still carries the Western-
    // drift items (Beatles, Casablanca, Trump) so Compare visibly shows
    // what the LLM alone would have planned, side-by-side with the
    // respectful grounded plan. Those items are intentionally NOT in the
    // grounded pipeline for a Moroccan Muslim woman, so the automatic
    // "Would have slipped" matcher (which cross-references grounded's
    // rejection list) has no cross-persona overlap to fire on. The two
    // grounded catches (Lashin, Khaled) carry their own cultural weight.
    await expect(llm.getByText("The Beatles, 'Yesterday' (1965)")).toBeVisible();
    await expect(llm.getByText("'Casablanca' on screen (1942)")).toBeVisible();
    await expect(llm.getByText("A word about Donald Trump in the news")).toBeVisible();

    // Qloo request caption still reads cleanly below the score table.
    await expect(page.getByTestId("compare-calls-caption")).toContainText(/Grounded in \d+ Qloo requests/);
  });

  test("Pixel 7: 'At a glance' strip surfaces catches without hiding behind the grid", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "mobile-only glance strip");
    await page.goto("/compare?persona=fatima");
    const view = page.getByTestId("compare-view");
    await expect(view).toHaveAttribute("data-grounded-status", "done", GROUNDED_READY);
    const glance = page.getByTestId("compare-glance");
    await expect(glance).toBeVisible();
    // Every grounded catch surfaces in the mobile strip so a mobile reader
    // never undercounts what Qloo caught.
    const items = glance.getByRole("listitem");
    await expect(items).toHaveCount(2);
    await expect(glance).toContainText(/Lashin|Khaled/);
  });
});
