/**
 * Demo screenshots for the README and submission (not an assertion suite).
 * Run: SCREENSHOTS=1 npx playwright test screenshots --project=chromium
 * Output: test-results/screenshots/ (git-ignored).
 */
import { expect, test, type Page } from "@playwright/test";

test.skip(!process.env.SCREENSHOTS, "Set SCREENSHOTS=1 to capture demo screenshots");

const OUT = "test-results/screenshots";

async function sessionDone(page: Page) {
  await page.goto("/session?persona=maria&source=sample&speed=40");
  await expect(page.getByTestId("session-view")).toHaveAttribute("data-status", "done");
  await page.waitForTimeout(600);
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(scheme, () => {
    test.use({ colorScheme: scheme, viewport: { width: 1440, height: 900 } });

    test("desktop", async ({ page }) => {
      await page.goto("/");
      await page.waitForTimeout(900);
      await page.screenshot({ path: `${OUT}/landing-${scheme}.png` });
      await page.goto("/session?persona=maria&source=sample&speed=1.5");
      await expect(page.getByTestId("reasoning-trace").locator('[data-phase="expand"]')).toHaveAttribute("data-status", "completed", {
        timeout: 20_000,
      });
      await page.screenshot({ path: `${OUT}/session-streaming-${scheme}.png` });
      await sessionDone(page);
      await page.screenshot({ path: `${OUT}/session-done-${scheme}.png` });
      await page.getByTestId("start-live").click();
      for (let i = 0; i < 3; i++) await page.getByTestId("live-next").click();
      await page.getByTestId("react-upset").click();
      await expect(page.getByTestId("live-up-next")).toContainText("Roberto Murolo");
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${OUT}/session-mode-replan-${scheme}.png` });
      await page.goto("/compare?persona=maria&source=sample&speed=40");
      await expect(page.getByTestId("compare-view")).toHaveAttribute("data-grounded-status", "done");
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${OUT}/compare-${scheme}.png`, fullPage: true });
    });
  });
}

test.describe("phone", () => {
  test.use({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  test("phone", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/phone-landing.png` });
    await sessionDone(page);
    await page.getByTestId("start-live").click();
    await page.getByTestId("live-next").click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/phone-session-mode.png` });
  });
});
