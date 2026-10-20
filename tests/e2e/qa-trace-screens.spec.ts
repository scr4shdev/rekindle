/**
 * One-shot QA screens: default trace view (closed details) per persona.
 * Run: QA_TRACE=1 npx playwright test qa-trace-screens --project=chromium
 */
import { expect, test, type Page } from "@playwright/test";

test.skip(!process.env.QA_TRACE, "Set QA_TRACE=1 to capture the trace cleanup screens");

const OUT = "/tmp/claude-1000/-home-zka/a670e3c8-bce6-4733-8506-b12ac4fce885/scratchpad/qa-screens/trace-cleanup";

async function captureTrace(page: Page, persona: string) {
  await page.goto(`/session?persona=${persona}&source=replay&speed=40`);
  await expect(page.getByTestId("session-view")).toHaveAttribute("data-status", "done", { timeout: 25_000 });
  await page.waitForTimeout(400);
  const trace = page.getByTestId("reasoning-trace");
  await trace.screenshot({ path: `${OUT}/${persona}-trace-default.png` });
}

test.use({ viewport: { width: 1440, height: 900 } });

for (const persona of ["maria", "fatima", "seamus"] as const) {
  test(`default trace view for ${persona}`, async ({ page }) => {
    await captureTrace(page, persona);
  });
}
