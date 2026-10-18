import { expect, test } from "@playwright/test";
import { SAMPLE_GROUNDED_EVENTS, SAMPLE_REPLAN_EVENTS } from "@/lib/domain/sample-events";
import type { ReplanRequestDraft } from "@/lib/domain/types";
import { mockStream } from "./helpers";

test.describe("caregiver session mode", () => {
  test("one prompt at a time with translation toggle, keyboard navigation and timer", async ({ page }) => {
    await page.goto("/session?persona=maria&source=sample&speed=40");
    await expect(page.getByTestId("session-view")).toHaveAttribute("data-status", "done");
    await page.getByTestId("start-live").click();
    const live = page.getByTestId("live-session");
    await expect(live).toBeVisible();
    await expect(page.getByTestId("live-prompt")).toContainText("Buongiorno Maria");
    await expect(page.getByTestId("live-prompt")).toHaveAttribute("lang", "it");
    await expect(page.getByTestId("live-timer")).toHaveText("2:00");
    // Focus starts on the session itself: Space toggles the timer and does not close the dialog.
    await page.keyboard.press(" ");
    await expect(live).toBeVisible();
    await expect(page.getByTestId("live-timer")).toHaveText("1:59", { timeout: 3000 });
    await expect(page.getByRole("button", { name: "Pause timer" })).toBeVisible();
    await expect(page.getByTestId("live-translation")).toBeVisible();
    await page.getByRole("button", { name: "Hide meaning" }).click();
    await expect(page.getByTestId("live-translation")).toBeHidden();
    await page.getByRole("button", { name: "Pause timer" }).click();
    await page.getByTestId("live-prompt").click();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("live-prompt")).toContainText("Ascoltiamo Sinatra");
    await expect(page.getByTestId("live-timer")).toHaveText("3:00");
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByTestId("live-prompt")).toContainText("Buongiorno Maria");
    await page.keyboard.press("Escape");
    await expect(live).toBeHidden();
  });

  test("the step timer keeps running through a reaction and its replan", async ({ page }) => {
    await page.goto("/session?persona=maria&source=sample&speed=40");
    await expect(page.getByTestId("session-view")).toHaveAttribute("data-status", "done");
    await page.getByTestId("start-live").click();
    for (let i = 0; i < 3; i++) await page.getByTestId("live-next").click();
    await expect(page.getByTestId("live-timer")).toHaveText("3:00");
    await page.getByRole("button", { name: "Start timer" }).click();
    await expect(page.getByTestId("live-timer")).toHaveText("2:59", { timeout: 3000 });
    // The recorded replan for this step changes the plan (new revision).
    await page.getByTestId("react-upset").click();
    await expect(page.getByTestId("live-up-next")).toContainText("Roberto Murolo");
    await expect(page.getByTestId("live-timer")).toHaveText(/^2:5[0-7]$/, { timeout: 4000 });
    await expect(page.getByRole("button", { name: "Pause timer" })).toBeVisible();
  });

  test("upset on the film still replans with a calming song (sample source)", async ({ page }) => {
    await page.goto("/session?persona=maria&source=sample&speed=40");
    await expect(page.getByTestId("session-view")).toHaveAttribute("data-status", "done");
    await page.getByTestId("start-live").click();
    for (let i = 0; i < 3; i++) await page.getByTestId("live-next").click();
    await expect(page.getByTestId("live-prompt")).toContainText("Sophia Loren");
    await expect(page.getByTestId("live-up-next")).toContainText("Forza Napoli");
    await page.getByTestId("react-upset").click();
    await expect(page.getByTestId("react-upset")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("live-up-next")).toContainText("Roberto Murolo");
    await expect(page.getByTestId("live-up-next")).toContainText("Adapted");
    await page.getByRole("button", { name: "Close session mode" }).click();
    await expect(page.locator('[data-step-id="s_murolo"]')).toHaveAttribute("data-changed", "true");
    await expect(page.getByText("Set aside for now: Forza Napoli: the Sívori years")).toBeVisible();
    await expect(page.getByText("Adapted once")).toBeVisible();
  });

  test("a reaction the recording does not cover keeps the plan and says so", async ({ page }) => {
    await page.goto("/session?persona=maria&source=sample&speed=40");
    await expect(page.getByTestId("session-view")).toHaveAttribute("data-status", "done");
    await page.getByTestId("start-live").click();
    await page.getByTestId("react-lit_up").click();
    await expect(page.getByText("Plan checked. Nothing needed to change.")).toBeVisible();
    await page.getByRole("button", { name: "Close session mode" }).click();
    await expect(page.getByText(/Adapted/)).toHaveCount(0);
  });

  test("reactions post a stateless replan request to the API", async ({ page }) => {
    await mockStream(page, "/api/session", SAMPLE_GROUNDED_EVENTS);
    let replanBody: ReplanRequestDraft | undefined;
    await mockStream(page, "/api/session/replan", (body) => {
      replanBody = body as ReplanRequestDraft;
      return SAMPLE_REPLAN_EVENTS;
    });
    await page.goto("/session?persona=maria&source=api");
    await expect(page.getByTestId("session-view")).toHaveAttribute("data-status", "done");
    await expect(page.getByText("Live planner")).toBeVisible();
    await page.getByTestId("start-live").click();
    await page.getByTestId("live-next").click();
    await page.getByTestId("react-lit_up").click();
    await expect(page.getByText(/Plan adapted/)).toBeVisible();
    await page.getByRole("button", { name: "Close session mode" }).click();
    await expect(page.getByText("Adapted once")).toBeVisible();
    expect(replanBody?.stepId).toBe("s_sinatra");
    expect(replanBody?.reaction).toBe("lit_up");
    expect(replanBody?.plan.id).toBe("plan_sample_maria");
    expect(replanBody?.anchors.birthYear).toBe(1942);
    expect(replanBody?.history).toEqual([]);
    // Changing the reaction on the same step, then reacting to the next one: history has one record per step.
    await page.keyboard.press("Escape");
    await page.getByTestId("start-live").click();
    await page.getByTestId("react-neutral").click();
    await expect(page.getByTestId("react-neutral")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("react-upset")).toBeEnabled();
    await page.getByTestId("live-next").click();
    await page.getByTestId("react-upset").click();
    await expect.poll(() => replanBody?.stepId).toBe("s_carosone");
    expect(replanBody?.history).toEqual([{ stepId: "s_sinatra", reaction: "neutral" }]);
  });
});

test("print view shows the session sheet without the trace", async ({ page }) => {
  await page.goto("/session?persona=maria&source=sample&speed=40");
  await expect(page.getByTestId("session-view")).toHaveAttribute("data-status", "done");
  await page.emulateMedia({ media: "print" });
  await expect(page.getByTestId("reasoning-trace")).toBeHidden();
  await expect(page.getByText("Session sheet")).toBeVisible();
  await expect(page.getByText("How did they respond?").first()).toBeVisible();
  await expect(page.getByRole("banner")).toBeHidden();
});
