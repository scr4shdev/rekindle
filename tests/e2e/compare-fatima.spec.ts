import { expect, test } from "@playwright/test";

/**
 * Fatima is the Potential Impact tiebreaker scenario: a Moroccan Muslim
 * elder from 1960s Fès whose grounded run catches one slip the LLM alone
 * waves through. The lifetime rail is narrow by design (only impossible
 * dates: future, or figures two generations before the subject): a 1938
 * Egyptian golden-age film like "Lashin" is NOT a lifetime violation for
 * a 1950-born Moroccan viewer, since canonical content transmits across
 * generations via family, cinema reruns and TV. The remaining catch is
 * cultural-era judgment, which the critique LLM does far better than a
 * date comparison: it flags "Khaled" (the raï singer famous from 1992,
 * long after Fatima's formative years) as an anachronism.
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
  test("hero stat, 1 catch, 3 would-slip badges, respectful content only", async ({ page }) => {
    await page.goto("/compare?persona=fatima");
    const view = page.getByTestId("compare-view");
    await expect(view).toHaveAttribute("data-llm-status", "done", GROUNDED_READY);
    await expect(view).toHaveAttribute("data-grounded-status", "done", GROUNDED_READY);

    // Hero stat callout leads with discovery for Fatima: Qloo-expand is
    // where Qloo earns its spot on this persona (Nass El Ghiwane, Fairuz,
    // Faten Hamama, Mohammed V, Warda), not the thin single-slip catch.
    // Headline shape is "Qloo brought N cultural anchors Fatima's notes
    // didn't name, caught M era slips, and confirmed K real matches."
    // Per-guard breakdown still lists only Critique caught 1 (Khaled):
    // the lifetime rail is narrow by design and no longer rejects pre-birth
    // canonical content, so Qloo refused is 0 and omitted from the breakdown.
    const headline = page.getByTestId("compare-headline");
    await expect(headline).toContainText("Qloo brought 7 cultural anchors Fatima's notes didn't name");
    await expect(headline).toContainText("caught 1 era slip");
    await expect(headline).toContainText("confirmed 10 real matches");
    const breakdown = page.getByTestId("compare-headline-breakdown");
    await expect(breakdown).toContainText("Critique caught 1");
    await expect(breakdown).not.toContainText("Qloo refused");
    await expect(breakdown).not.toContainText("Cultural grounding");

    // Score table reports one catch in the grounded column.
    const score = page.getByTestId("compare-score");
    await expect(score.getByRole("row", { name: /Era, place or risk slips avoided/ })).toContainText("1");

    const grounded = page.getByTestId("compare-grounded");
    const llm = page.getByTestId("compare-llm");

    // Grounded Caught box lists Khaled (anachronism, caught by critique).
    // Lashin no longer appears: the lifetime rail only blocks impossible
    // dates, and the compose fixture no longer proposes Lashin for Fatima.
    await expect(grounded.getByText("Khaled", { exact: true })).toBeVisible();
    await expect(grounded.getByText("Lashin", { exact: true })).toHaveCount(0);
    await expect(grounded.getByText("Wrong era")).toHaveCount(1);

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
    // rejection list) has no cross-persona overlap to fire on. The one
    // grounded catch (Khaled) carries the cultural-era weight.
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
    await expect(items).toHaveCount(1);
    await expect(glance).toContainText("Khaled");
  });
});
