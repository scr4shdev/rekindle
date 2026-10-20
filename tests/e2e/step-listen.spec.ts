import { expect, test } from "@playwright/test";

/**
 * The Listen button is what turns Rekindle from illustrative into usable for
 * the hardest case: an English-reading aide standing next to Fatima, holding
 * a card of French (or Darija) prompts she cannot pronounce. This spec checks
 * that the button renders on her plan, carries the right aria-label, and a
 * click reaches the Web Speech API without crashing. Audio itself is mocked.
 *
 * Chromium only: Playwright cannot reliably exercise real speech synthesis
 * across browsers, and we never want CI to make noise.
 */
test.use({ browserName: "chromium" });

test.describe("step listen button", () => {
  test("Fatima plan has a Listen button that fires speak() on click", async ({ page }) => {
    // Mock the Web Speech API before any page script runs. We record each
    // utterance so we can assert the click really reaches it.
    await page.addInitScript(() => {
      type Spoken = { text: string; lang: string; rate: number; voice?: string };
      const spoken: Spoken[] = [];
      class FakeUtterance {
        text: string;
        lang = "";
        rate = 1;
        voice: { name: string; lang: string } | null = null;
        onstart: (() => void) | null = null;
        onend: (() => void) | null = null;
        onerror: (() => void) | null = null;
        constructor(text: string) {
          this.text = text;
        }
      }
      const voices = [
        { name: "French (France)", lang: "fr-FR", default: true },
        { name: "English (US)", lang: "en-US" },
      ];
      const fakeSynth = {
        getVoices: () => voices,
        speak: (u: FakeUtterance) => {
          spoken.push({ text: u.text, lang: u.lang, rate: u.rate, voice: u.voice?.name });
          // Simulate async start/end so the button toggles back to idle.
          setTimeout(() => u.onstart?.(), 0);
          setTimeout(() => u.onend?.(), 10);
        },
        cancel: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
      };
      Object.defineProperty(window, "speechSynthesis", { configurable: true, get: () => fakeSynth });
      (window as unknown as { SpeechSynthesisUtterance: typeof FakeUtterance }).SpeechSynthesisUtterance = FakeUtterance;
      (window as unknown as { __spoken: Spoken[] }).__spoken = spoken;
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
    const spokenCount = await page.evaluate(() => (window as unknown as { __spoken: unknown[] }).__spoken.length);
    expect(spokenCount).toBe(1);
    const utterance = await page.evaluate(
      () => (window as unknown as { __spoken: { text: string; lang: string; rate: number; voice?: string }[] }).__spoken[0],
    );
    expect(utterance.lang.toLowerCase()).toMatch(/^fr/);
    expect(utterance.rate).toBeCloseTo(0.95, 2);
  });
});
