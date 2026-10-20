import { expect, test } from "@playwright/test";

/**
 * Real Pixel 7 viewport width (393px, DPR 2.625). The earlier mobile pass used
 * ~500px because the MCP viewport did not shrink further; this spec asserts
 * every surface a judge might open on a phone fits without horizontal scroll.
 */
const WIDTH = 393;

const PAGES = [
  { path: "/", ready: "[data-testid=custom-form]" },
  { path: "/session?persona=fatima&source=replay&speed=40", ready: "[data-status=done]" },
  { path: "/compare?persona=fatima&source=sample&speed=40", ready: "[data-grounded-status=done]" },
];

test.describe("pixel 7 (393x852)", () => {
  // The chromium project uses an isMobile=false viewport that renders a few
  // pixels wider for the same width due to desktop scroll-gutter reservation.
  // The real-phone case is what we care about, so skip the chromium pass.
  test.skip(({ isMobile }) => !isMobile, "mobile emulation only");
  test.use({ viewport: { width: WIDTH, height: 852 } });
  for (const { path, ready } of PAGES) {
    test(`no horizontal overflow on ${path.split("?")[0]}`, async ({ page }) => {
      await page.goto(path);
      await page.waitForSelector(ready);
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth).toBeLessThanOrEqual(WIDTH);
    });
  }
});
