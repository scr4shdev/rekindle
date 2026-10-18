import { expect, test } from "@playwright/test";

const PAGES = [
  { path: "/", ready: "[data-testid=custom-form]" },
  { path: "/session?persona=maria&source=sample&speed=40", ready: "[data-status=done]" },
  { path: "/compare?persona=maria&source=sample&speed=40", ready: "[data-grounded-status=done]" },
];

test.describe("small phones (360px)", () => {
  test.use({ viewport: { width: 360, height: 740 } });
  for (const { path, ready } of PAGES) {
    test(`no horizontal scrolling on ${path.split("?")[0]}`, async ({ page }) => {
      await page.goto(path);
      await page.waitForSelector(ready);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }

  test("touch targets in session mode are at least 44px", async ({ page }) => {
    await page.goto("/session?persona=maria&source=sample&speed=40");
    await page.waitForSelector("[data-status=done]");
    await page.getByTestId("start-live").click();
    for (const id of ["react-lit_up", "react-neutral", "react-upset", "live-next"]) {
      const box = await page.getByTestId(id).boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    }
  });
});
