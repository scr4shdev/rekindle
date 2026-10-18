import { expect, test } from "@playwright/test";
import { SAMPLE_GROUNDED_EVENTS } from "@/lib/domain/sample-events";
import type { AgentEvent } from "@/lib/domain/types";
import { DONE, mockJsonError, mockStream, stamp } from "./helpers";

test.describe("session error and degraded states", () => {
  test("fatal error event shows a safe message and a retry", async ({ page }) => {
    await mockStream(
      page,
      "/api/session",
      stamp([
        { type: "phase", phase: "parse", status: "started", message: "Reading your notes…" },
        { type: "error", code: "llm_unavailable", message: "The language model is unavailable right now.", recoverable: false, phase: "parse" },
        DONE,
      ]),
    );
    await page.goto("/session?persona=seamus&source=api");
    await expect(page.getByTestId("session-alert")).toContainText("The language model is unavailable right now.");
    await expect(page.getByTestId("session-view")).toHaveAttribute("data-status", "error");
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open Maria's recorded demo" })).toBeVisible();
    await expect(page.getByTestId("plan-placeholder")).toContainText("No plan this time");
  });

  test("400 before streaming maps to a friendly message without echoing input", async ({ page }) => {
    await mockJsonError(page, "/api/session", 400, "invalid_input");
    await page.goto("/session?persona=fatima&source=api");
    const alert = page.getByTestId("session-alert");
    await expect(alert).toContainText("could not accept these notes");
    await expect(alert).not.toContainText("Fès");
  });

  test("recoverable error keeps the plan and shows a degraded notice", async ({ page }) => {
    const events: AgentEvent[] = [...SAMPLE_GROUNDED_EVENTS];
    const verifyStart = events.findIndex((e) => e.type === "phase" && e.phase === "verify" && e.status === "started");
    events.splice(verifyStart + 1, 0, {
      type: "error",
      code: "qloo_unavailable",
      message: "Qloo did not answer, continuing with language model ideas.",
      recoverable: true,
      phase: "verify",
      seq: 0,
      t: 0,
    });
    await mockStream(page, "/api/session", events.map((e, seq) => ({ ...e, seq })));
    await page.goto("/session?persona=maria&source=api");
    await expect(page.getByTestId("session-view")).toHaveAttribute("data-status", "done");
    await expect(page.getByText("Recovered:")).toBeVisible();
    await expect(page.getByText("Some checks could not run")).toBeVisible();
    await expect(page.getByTestId("step-card")).toHaveCount(8);
  });

  test("stop cancels the stream and retry starts again", async ({ page }) => {
    await page.goto("/session?persona=maria&source=sample&speed=0.5");
    await page.getByRole("button", { name: "Stop" }).click();
    await expect(page.getByTestId("session-view")).toHaveAttribute("data-status", "cancelled");
    await expect(page.getByText("Stopped. Nothing was kept.")).toBeVisible();
    await expect(page.getByTestId("plan-placeholder")).toContainText("Stopped before a plan was made");
    await page.goto("/session?persona=maria&source=sample&speed=40");
    await expect(page.getByTestId("session-view")).toHaveAttribute("data-status", "done");
  });

  test("custom session after reload explains that nothing was kept", async ({ page }) => {
    await page.goto("/session?persona=custom");
    await expect(page.getByTestId("session-alert")).toContainText("reloading the page cleared them");
  });
});
