import { expect, test } from "@playwright/test";
import { SAMPLE_GROUNDED_EVENTS, SAMPLE_LLM_ONLY_EVENTS } from "@/lib/domain/sample-events";
import type { SessionRequestDraft } from "@/lib/domain/types";
import { mockLiveHealth, mockStream } from "./helpers";

const NOTES = "Dad was born in 1946 in Lyon and worked on the railways. He loved Johnny Hallyday and the Tour de France.";

test.describe("custom person form", () => {
  test.beforeEach(async ({ page }) => {
    await mockLiveHealth(page);
  });

  test("shows accessible errors and focuses the first invalid field", async ({ page }) => {
    await page.goto("/");
    const form = page.getByTestId("custom-form");
    await form.getByLabel("Birth year").fill("1700");
    await form.getByRole("button", { name: "Plan the session" }).click();
    await expect(form.getByRole("alert")).toContainText("Please check the highlighted fields.");
    const notes = form.getByLabel("Tell us about them");
    await expect(notes).toHaveAttribute("aria-invalid", "true");
    await expect(notes).toBeFocused();
    await expect(form.getByText("Please write at least a sentence")).toBeVisible();
    await expect(form.getByLabel("Birth year")).toHaveAttribute("aria-invalid", "true");
    await expect(page).toHaveURL(/\/$/);
  });

  test("valid input opens the session; notes travel only in the POST body", async ({ page }) => {
    let request: SessionRequestDraft | undefined;
    await mockStream(page, "/api/session", (body) => {
      request = body as SessionRequestDraft;
      return SAMPLE_GROUNDED_EVENTS;
    });
    await page.goto("/");
    const form = page.getByTestId("custom-form");
    await form.getByLabel("Tell us about them").fill(NOTES);
    await form.getByLabel("What do you call them?").fill("Papa");
    await form.getByLabel("Birth year").fill("1946");
    await form.getByLabel("Where they grew up").fill("Lyon, France");
    await form.getByLabel("Language they speak best").selectOption("fr");
    await form.getByText("30 min").click();
    await form.getByRole("button", { name: "Plan the session" }).click();
    await expect(page).toHaveURL(/\/session\?persona=custom&mode=grounded$/);
    await expect(page.getByTestId("session-view")).toHaveAttribute("data-status", "done");
    expect(request?.person).toMatchObject({
      notes: NOTES,
      displayName: "Papa",
      birthYear: 1946,
      birthPlace: "Lyon, France",
      sessionLanguage: "fr",
      sessionMinutes: 30,
    });
    expect(page.url()).not.toContain("Lyon");
    // Nothing persisted in browser storage.
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
    expect(stored).not.toContain("railways");
  });

  test("turning Qloo off requests an llm-only plan", async ({ page }) => {
    const modes: string[] = [];
    await mockStream(page, "/api/session", (body) => {
      modes.push((body as SessionRequestDraft).mode ?? "grounded");
      return SAMPLE_LLM_ONLY_EVENTS;
    });
    await page.goto("/");
    const form = page.getByTestId("custom-form");
    await form.getByLabel("Tell us about them").fill(NOTES);
    await form.getByRole("switch", { name: "Check every idea against Qloo" }).click();
    await form.getByRole("button", { name: "Plan the session" }).click();
    await expect(page).toHaveURL(/mode=llm-only/);
    await expect(page.getByTestId("session-view")).toHaveAttribute("data-status", "done");
    await expect(page.getByText("Language model only")).toBeVisible();
    expect(new Set(modes)).toEqual(new Set(["llm-only"]));
  });

  test("compare button opens the comparison for the same notes", async ({ page }) => {
    await mockStream(page, "/api/session", (body) =>
      (body as SessionRequestDraft).mode === "llm-only" ? SAMPLE_LLM_ONLY_EVENTS : SAMPLE_GROUNDED_EVENTS,
    );
    await page.goto("/");
    const form = page.getByTestId("custom-form");
    await form.getByLabel("Tell us about them").fill(NOTES);
    await form.getByRole("button", { name: "Compare with and without Qloo" }).click();
    await expect(page).toHaveURL(/\/compare\?persona=custom$/);
    await expect(page.getByTestId("compare-view")).toHaveAttribute("data-grounded-status", "done");
  });
});
