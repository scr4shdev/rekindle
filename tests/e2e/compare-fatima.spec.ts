import { expect, test } from "@playwright/test";

/**
 * Fatima is the Potential Impact tiebreaker scenario: a Moroccan Muslim
 * elder from 1960s Fès. Qloo-expand is where Qloo earns its spot on this
 * persona (Nass El Ghiwane, Fairuz, Oum Kalthoum, Faten Hamama), while the
 * critique and cultural-check guards set aside the affinity results that
 * drift out of her era or her world. Nothing with alcohol or Western
 * political figures ever reaches the grounded pipeline.
 *
 * The compare page defaults to apiSource for Fatima (no sample recording),
 * so both columns run the real agent against live Gemini and live Qloo.
 * Gemini is not byte-deterministic even at temperature 0, so the exact
 * counts and the exact entity names shift between runs. This spec therefore
 * asserts shape and consistency, not exact values:
 *
 * - the three hero counts (surfaced, caught, confirmed) parse as
 *   non-negative integers and land inside a range centred on the committed
 *   fixture `tests/fixtures/trace-fatima.ndjson` (recorded 2026-10-24),
 *   with a tolerance of plus or minus 3 or plus or minus 25 percent,
 *   whichever is larger;
 * - the headline, the per-guard breakdown, the score table, the grounded
 *   "Caught" box and the mobile glance strip all agree on the same caught
 *   count (the invariant compare-view.spec.ts and compare-counts.test.ts
 *   pin on fixtures);
 * - the respectful-content rule holds regardless of what the model picks.
 */

const GROUNDED_READY = { timeout: 25_000 };

/** Latest committed fixture values (see tests/unit/compare-counts.test.ts). */
const FIXTURE = { brought: 8, caught: 10, verified: 5 } as const;

/** Range centred on the fixture: max(3, 25 percent), floored at 0. */
function range(center: number): { min: number; max: number } {
  const tolerance = Math.max(3, Math.ceil(center * 0.25));
  return { min: Math.max(0, center - tolerance), max: center + tolerance };
}

function expectNonNegativeInt(value: number, label: string) {
  expect(Number.isInteger(value), `${label} should be an integer, got ${value}`).toBe(true);
  expect(value, `${label} should be non-negative`).toBeGreaterThanOrEqual(0);
}

function expectWithin(value: number, center: number, label: string) {
  const { min, max } = range(center);
  expect(value, `${label} should be within [${min}, ${max}] (fixture ${center})`).toBeGreaterThanOrEqual(min);
  expect(value, `${label} should be within [${min}, ${max}] (fixture ${center})`).toBeLessThanOrEqual(max);
}

/** Pull the integer out of a clause like "caught 3 era slips"; 0 when the clause is absent. */
function clauseCount(text: string, pattern: RegExp): number {
  const match = text.match(pattern);
  return match ? Number(match[1]) : 0;
}

// The compare page for Fatima defaults to apiSource (no sample recording),
// so these specs exercise the live /api/session endpoint and require real
// Gemini + Qloo keys. Without them they would hit the webServer's
// LlmNotConfiguredError. Skip when GEMINI_API_KEY is not in the env.
test.describe("compare mode: Fatima tiebreaker", () => {
  test.skip(() => !process.env.GEMINI_API_KEY, "needs live Gemini key; run in CI with the key set");
  test("hero stat counts are plausible and consistent across surfaces, respectful content only", async ({ page }) => {
    await page.goto("/compare?persona=fatima");
    const view = page.getByTestId("compare-view");
    await expect(view).toHaveAttribute("data-llm-status", "done", GROUNDED_READY);
    await expect(view).toHaveAttribute("data-grounded-status", "done", GROUNDED_READY);

    // Hero stat callout leads with discovery for Fatima. Headline shape is
    // "Qloo surfaced N cultural anchors Fatima's notes didn't mention,
    // caught M era slips, and confirmed K real matches." Each clause is
    // omitted when its count is 0, so a missing clause reads as 0.
    const headline = page.getByTestId("compare-headline");
    await expect(headline).toContainText(/Qloo surfaced \d+ cultural anchors? Fatima's notes didn't mention/);
    const headlineText = (await headline.innerText()).replace(/\s+/g, " ");
    const brought = clauseCount(headlineText, /Qloo surfaced (\d+) cultural anchor/);
    const caught = clauseCount(headlineText, /caught (\d+) era slip/);
    const verified = clauseCount(headlineText, /confirmed (\d+) real match/);
    expectNonNegativeInt(brought, "surfaced anchors");
    expectNonNegativeInt(caught, "caught era slips");
    expectNonNegativeInt(verified, "confirmed matches");
    expectWithin(brought, FIXTURE.brought, "surfaced anchors");
    expectWithin(caught, FIXTURE.caught, "caught era slips");
    expectWithin(verified, FIXTURE.verified, "confirmed matches");
    // Fatima's pitch is discovery plus at least one catch: the page must
    // never fall through to the "no slips" or "Qloo was quiet" variants.
    expect(brought, "Qloo-expand should surface at least one anchor").toBeGreaterThan(0);
    expect(caught, "the grounded run should set aside at least one slip").toBeGreaterThan(0);
    await expect(page.getByTestId("compare-headline-qloo-quiet")).toHaveCount(0);

    // Per-guard breakdown ("Qloo refused A, Cultural grounding caught B,
    // Critique caught C") partitions the same caught list, so its parts sum
    // to the hero count.
    const breakdown = page.getByTestId("compare-headline-breakdown");
    await expect(breakdown).toBeVisible();
    const breakdownText = (await breakdown.innerText()).replace(/\s+/g, " ");
    const bySource =
      clauseCount(breakdownText, /Qloo refused (\d+)/) +
      clauseCount(breakdownText, /Cultural grounding caught (\d+)/) +
      clauseCount(breakdownText, /Critique caught (\d+)/);
    expect(bySource, "breakdown parts should sum to the hero caught count").toBe(caught);

    // Score table reports the same three numbers in the grounded column.
    const score = page.getByTestId("compare-score");
    const groundedCell = (name: RegExp) => score.getByRole("row", { name }).getByRole("cell").last();
    await expect(groundedCell(/Era, place or risk slips avoided/)).toHaveText(String(caught));
    await expect(groundedCell(/Taste discoveries from Qloo/)).toHaveText(String(brought));
    await expect(groundedCell(/Songs, films and faces confirmed real/)).toHaveText(String(verified));

    const grounded = page.getByTestId("compare-grounded");
    const llm = page.getByTestId("compare-llm");

    // Grounded "Caught before reaching the plan" box lists every pre-plan
    // rejection; the hero counts only the era/place/risk subset, so the box
    // holds at least that many entries and at least one is an era slip.
    const caughtBox = grounded.locator("div").filter({ has: grounded.getByRole("heading", { name: "Caught before reaching the plan" }) }).last();
    await expect(caughtBox.getByRole("listitem").first()).toBeVisible();
    expect(await caughtBox.getByRole("listitem").count()).toBeGreaterThanOrEqual(caught);
    await expect(grounded.getByText("Wrong era").first()).toBeVisible();

    // Nothing with alcohol or Western political figures ever reaches the
    // grounded pipeline for a Moroccan Muslim woman's reminiscence session.
    for (const banned of ["Stella Artois", "Donald Trump", "The Beatles", "Casablanca"]) {
      await expect(grounded.getByText(banned, { exact: true })).toHaveCount(0);
    }

    // LLM-only column renders its own plan side-by-side with the grounded
    // one, so a reader sees what the model alone would have planned. Its
    // step titles come from the live model and are not pinned here.
    await expect(llm.getByRole("listitem").first()).toBeVisible();

    // Qloo request caption still reads cleanly below the score table.
    await expect(page.getByTestId("compare-calls-caption")).toContainText(/Grounded in \d+ Qloo requests/);
  });

  test("Pixel 7: 'At a glance' strip surfaces catches without hiding behind the grid", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "mobile-only glance strip");
    await page.goto("/compare?persona=fatima");
    const view = page.getByTestId("compare-view");
    await expect(view).toHaveAttribute("data-grounded-status", "done", GROUNDED_READY);
    const headlineText = (await page.getByTestId("compare-headline").innerText()).replace(/\s+/g, " ");
    const caught = clauseCount(headlineText, /caught (\d+) era slip/);
    expect(caught, "the grounded run should set aside at least one slip").toBeGreaterThan(0);
    const glance = page.getByTestId("compare-glance");
    await expect(glance).toBeVisible();
    // Every grounded catch surfaces in the mobile strip so a mobile reader
    // never undercounts what Qloo caught: one list item per hero catch.
    await expect(glance.getByRole("listitem")).toHaveCount(caught);
  });
});
