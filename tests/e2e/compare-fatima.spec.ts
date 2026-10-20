import { expect, test } from "@playwright/test";

/**
 * Fatima is the Potential Impact tiebreaker scenario: a Moroccan elder from
 * 1960s Fes whose grounded run should catch five slips that the LLM alone
 * waves through. Three of them are Western-drift items the hand-authored
 * cultural-check phase flags with "Doesn't fit culture" (The Beatles,
 * Casablanca, Donald Trump); the other two are the existing anachronism
 * (Khaled) and emotional-risk (Stella Artois) catches.
 *
 * The compare page defaults to apiSource for Fatima (no sample recording),
 * so this spec goes straight to /compare?persona=fatima and reads from the
 * real agent running against mock LLM + mock Qloo. Those mock adapters
 * carry hand-authored verdicts for Fatima, so the five catches are
 * deterministic without stubbing the stream.
 */

const GROUNDED_READY = { timeout: 25_000 };

test.describe("compare mode: Fatima tiebreaker", () => {
  test("hero stat, 5 catches, 3 would-slip badges, cultural-mismatch rejects, mint-tea / Khaled sanity", async ({ page }) => {
    await page.goto("/compare?persona=fatima");
    const view = page.getByTestId("compare-view");
    await expect(view).toHaveAttribute("data-llm-status", "done", GROUNDED_READY);
    await expect(view).toHaveAttribute("data-grounded-status", "done", GROUNDED_READY);

    // Hero stat callout: "Qloo caught 5 era/culture/risk slips…" with exact 5.
    const headline = page.getByTestId("compare-headline");
    await expect(headline).toContainText("Qloo caught 5");
    await expect(headline).toContainText("slips");

    // Score table reports five catches in the grounded column.
    const score = page.getByTestId("compare-score");
    await expect(score.getByRole("row", { name: /Era, place or risk slips avoided/ })).toContainText("5");

    const grounded = page.getByTestId("compare-grounded");
    const llm = page.getByTestId("compare-llm");

    // Grounded Caught box lists all five rejected labels. Trump, Beatles and
    // Casablanca carry the "Doesn't fit culture" badge (cultural_mismatch
    // sentinel rewrites the frozen wrong_locale kind). Khaled stays as the
    // anachronism catch; Stella Artois as the emotional-risk one.
    for (const label of ["The Beatles", "Casablanca", "Donald Trump", "Khaled", "Stella Artois"]) {
      await expect(grounded.getByText(label, { exact: true })).toBeVisible();
    }

    // Three "Doesn't fit culture" badges live on the Western-drift items.
    await expect(grounded.getByText("Doesn't fit culture")).toHaveCount(3);
    // The pre-existing anachronism and alcohol catches must stay rendered.
    await expect(grounded.getByText("Wrong era")).toHaveCount(1);
    await expect(grounded.getByText("Could upset")).toHaveCount(1);

    // LLM-only column: at least three steps are flagged as "Would have
    // slipped" (data-slip=true on the li). The compare view only sets the
    // flag on LLM steps whose titles share a specific token with a rejection,
    // so Beatles / Casablanca / Trump light up but neither Mint tea nor the
    // Opening ("Tea together") does.
    const slips = llm.locator('[data-slip="true"]');
    await expect(slips).toHaveCount(3);
    await expect(slips).toContainText(["Beatles", "Casablanca", "Trump"]);
    await expect(llm.getByText("Would have slipped")).toHaveCount(3);

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
    await expect(items).toHaveCount(5);
    await expect(glance).toContainText(/Beatles|Casablanca|Donald Trump|Khaled|Stella/);
    await expect(glance.getByText("Doesn't fit culture").first()).toBeVisible();
  });
});
