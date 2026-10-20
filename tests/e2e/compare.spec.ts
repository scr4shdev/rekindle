import { expect, test } from "@playwright/test";
import { SAMPLE_GROUNDED_EVENTS, SAMPLE_LLM_ONLY_EVENTS } from "@/lib/domain/sample-events";
import type { SessionRequestDraft } from "@/lib/domain/types";
import { mockStream } from "./helpers";

test.describe("comparison mode", () => {
  test("runs grounded and llm-only side by side with a summary (sample source)", async ({ page }) => {
    await page.goto("/compare?persona=maria&source=sample&speed=40");
    const view = page.getByTestId("compare-view");
    await expect(view).toHaveAttribute("data-grounded-status", "done");
    await expect(view).toHaveAttribute("data-llm-status", "done");
    const score = page.getByTestId("compare-score");
    await expect(score.getByRole("row", { name: /Songs, films and faces confirmed real/ })).toContainText("unchecked");
    await expect(score.getByRole("row", { name: /Steps anchored in something real/ })).toContainText("5 of 8");
    await expect(page.getByTestId("compare-llm").getByTestId("compare-step")).toHaveCount(6);
    await expect(page.getByTestId("compare-grounded").getByTestId("compare-step")).toHaveCount(8);
    await expect(page.getByTestId("compare-grounded")).toContainText("Diego Maradona");
    await expect(page.getByTestId("compare-llm")).toContainText("Maradona and the 1987 scudetto");
  });

  test("Maria hero still leads with the catch frame (Maradona 1987 is her money shot)", async ({ page }) => {
    // Maria's grounded trace catches 5 era/culture slips (b.caught = 5)
    // against her 1954-1967 formative window, the dramatic "would have
    // slipped" story Qloo earns on this persona. The discovery frame
    // (brought 11) still leads, but the test locks in that both the
    // "brought" and "caught" clauses are present in the hero so the
    // Maria run keeps its catch moment on the Compare page.
    await page.goto("/compare?persona=maria");
    const view = page.getByTestId("compare-view");
    await expect(view).toHaveAttribute("data-grounded-status", "done", { timeout: 25_000 });
    const headline = page.getByTestId("compare-headline");
    await expect(headline).toContainText("Qloo surfaced 11 cultural anchors");
    await expect(headline).toContainText("caught 5 era slips");
    await expect(headline).toContainText("confirmed 10 real matches");
  });

  test("sends two parallel API requests with the same person, one per mode", async ({ page }) => {
    const modes: string[] = [];
    await mockStream(page, "/api/session", (body) => {
      const request = body as SessionRequestDraft;
      modes.push(request.mode ?? "grounded");
      return request.mode === "llm-only" ? SAMPLE_LLM_ONLY_EVENTS : SAMPLE_GROUNDED_EVENTS;
    });
    await page.goto("/compare?persona=maria&source=api");
    await expect(page.getByTestId("compare-view")).toHaveAttribute("data-grounded-status", "done");
    await expect(page.getByTestId("compare-view")).toHaveAttribute("data-llm-status", "done");
    // React dev mode may run effects twice; each run sends exactly one request per mode.
    expect([...new Set(modes)].sort()).toEqual(["grounded", "llm-only"]);
    expect(modes.filter((m) => m === "grounded").length).toBe(modes.filter((m) => m === "llm-only").length);
  });
});
