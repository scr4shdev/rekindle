import { expect, test, type Page } from "@playwright/test";

/**
 * The Listen button is what turns Rekindle from illustrative into usable for
 * the hardest case: an English-reading aide standing next to Fatima, holding
 * a card of French (or Darija) prompts she cannot pronounce. Audio always
 * comes from `/api/tts` (Gemini). This spec checks that the button renders,
 * carries the right aria-label, hits `/api/tts` on click, and, when the
 * service returns 503, shows the honest error state and the localised copy.
 *
 * Chromium only: Playwright cannot reliably exercise real audio across
 * browsers, and we never want CI to make noise.
 */
test.use({ browserName: "chromium" });

/**
 * Stub `HTMLAudioElement.play` so Playwright never actually tries to play
 * audio in CI. Dispatch `play` and `ended` so the hook flips its state.
 */
async function stubAudioPlayback(page: Page): Promise<void> {
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = function stubbedPlay() {
      setTimeout(() => this.dispatchEvent(new Event("play")), 0);
      setTimeout(() => this.dispatchEvent(new Event("ended")), 20);
      return Promise.resolve();
    };
  });
}

test.describe("step listen button", () => {
  test("Fatima plan has a Listen button that fetches /api/tts on click", async ({ page }) => {
    await stubAudioPlayback(page);
    const silentWav = Buffer.from(
      "UklGRiQAAABXQVZFZm10IBAAAAABAAEAwF0AAIC7AAACABAAZGF0YQAAAAA=",
      "base64",
    );
    let ttsHits = 0;
    await page.route("**/api/tts", (route) => {
      ttsHits += 1;
      void route.fulfill({
        status: 200,
        contentType: "audio/wav",
        headers: { "x-tts-provider": "gemini", "x-tts-cached": "false" },
        body: silentWav,
      });
    });

    await page.goto("/session?persona=fatima&source=replay");
    await expect(page.getByTestId("session-view")).toHaveAttribute("data-status", "done", { timeout: 25_000 });

    const listenButtons = page.getByTestId("step-listen");
    const count = await listenButtons.count();
    expect(count).toBeGreaterThan(0);

    const first = listenButtons.first();
    // Caregiver is English, prompt is French: label mentions French.
    await expect(first).toHaveAttribute("aria-label", /Listen to the prompt in French/i);
    // Keyboard-reachable via a real <button>.
    await expect(first).toHaveJSProperty("tagName", "BUTTON");

    await first.click();
    await expect.poll(() => ttsHits).toBeGreaterThan(0);
    // No error line should be present on the happy path.
    await expect(page.getByTestId("step-listen-error")).toHaveCount(0);
  });

  test("shows the error state and localised line when /api/tts returns 503", async ({ page }) => {
    await stubAudioPlayback(page);

    let ttsHits = 0;
    await page.route("**/api/tts", (route) => {
      ttsHits += 1;
      void route.fulfill({
        status: 503,
        contentType: "application/json",
        headers: { "x-tts-provider": "mock" },
        body: JSON.stringify({ error: { code: "tts_unavailable", message: "no key" } }),
      });
    });

    await page.goto("/session?persona=fatima&source=replay");
    await expect(page.getByTestId("session-view")).toHaveAttribute("data-status", "done", { timeout: 25_000 });

    const first = page.getByTestId("step-listen").first();
    await first.click();
    await expect.poll(() => ttsHits).toBeGreaterThan(0);
    // The error state hint shows up with the English copy.
    const errorLine = page.getByTestId("step-listen-error").first();
    await expect(errorLine).toBeVisible();
    await expect(errorLine).toHaveText("Voice unavailable right now.");
    // The button carries the error attribute so the icon reflects it.
    await expect(first).toHaveAttribute("data-error", "unavailable");
  });
});
