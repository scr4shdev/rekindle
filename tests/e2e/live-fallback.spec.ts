import { expect, test } from "@playwright/test";

/**
 * When a live run (source != replay/sample) has emitted its first phase but
 * is still waiting on `plan`/`done` after 25 seconds, the session view bails
 * to `?source=replay&from=live-timeout` and shows a soft toast so a judge
 * never sits in front of a dead page. Replay/sample paths never auto-switch.
 *
 * The timeout is 25s in production; the test needs that window to actually
 * elapse, so it is marked slow() rather than monkeypatched. The live API is
 * stubbed to emit one phase event and then hang.
 */
test.describe("live timeout fallback", () => {
  test("live stalls past 25 s then shows the replay with a toast", async ({ page }) => {
    test.slow();
    // Emit one phase=parse "started" event, then keep the stream open with no further bytes.
    // This matches the "first phase landed, but nothing after" shape the fallback is tuned for.
    await page.route("**/api/session", async (route) => {
      const line = JSON.stringify({ type: "phase", phase: "parse", status: "started", message: "Reading your notes", seq: 0, t: 0 }) + "\n";
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/x-ndjson" },
        body: line + " ".repeat(1024), // flushable chunk; nothing else arrives
      });
    });
    await page.goto("/session?persona=maria&source=api");
    // Wait for the auto-switch and the toast. The URL carries both the replay
    // source and the fallback marker; the toast reads the honest copy.
    await expect(page).toHaveURL(/source=replay/, { timeout: 35_000 });
    await expect(page).toHaveURL(/from=live-timeout/);
    await expect(page.getByText("Live model is slow today. Showing the recorded run.")).toBeVisible();
    // The replay fixture completes well under 25 s.
    await expect(page.getByTestId("session-view")).toHaveAttribute("data-status", "done", { timeout: 25_000 });
    await expect(page.getByTestId("qloo-mode")).toContainText("Qloo: demo data");
  });

  test("replay source never auto-switches (would loop)", async ({ page }) => {
    await page.goto("/session?persona=maria&source=replay");
    await expect(page.getByTestId("session-view")).toHaveAttribute("data-status", "done", { timeout: 25_000 });
    // URL never grows a from=live-timeout marker on a replay run.
    await expect(page).not.toHaveURL(/from=live-timeout/);
    await expect(page.getByTestId("run-live")).toBeVisible();
  });

  test("Compare: live stalls past 15 s then shows the replay with a toast", async ({ page }) => {
    test.slow();
    // Compare fires two /api/session requests in parallel (llm-only and
    // grounded). Stub both with one phase=parse "started" event, then hang
    // the stream so the fallback timer trips. The glob is anchored at the
    // query string so the replay endpoint (/api/session/replay) is NOT
    // caught by this route and can serve the fixture after the swap.
    await page.route((url) => url.pathname === "/api/session", async (route) => {
      const line = JSON.stringify({ type: "phase", phase: "parse", status: "started", message: "Reading your notes", seq: 0, t: 0 }) + "\n";
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/x-ndjson" },
        body: line + " ".repeat(1024),
      });
    });
    await page.goto("/compare?persona=maria&source=api");
    await expect(page).toHaveURL(/source=replay/, { timeout: 25_000 });
    await expect(page).toHaveURL(/from=live-timeout/);
    await expect(page.getByText("Live model is slow today. Showing the recorded run.")).toBeVisible();
    // Both panes finish once the replay fixture is swapped in.
    await expect(page.getByTestId("compare-view")).toHaveAttribute("data-grounded-status", "done", { timeout: 25_000 });
    await expect(page.getByTestId("compare-view")).toHaveAttribute("data-llm-status", "done", { timeout: 25_000 });
  });
});
