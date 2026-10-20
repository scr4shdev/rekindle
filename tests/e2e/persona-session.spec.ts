import { expect, test } from "@playwright/test";
import { SAMPLE_GROUNDED_EVENTS } from "@/lib/domain/sample-events";
import type { SessionRequestDraft } from "@/lib/domain/types";
import { mockStream } from "./helpers";

test.describe("persona to session", () => {
  test("landing shows three one-tap personas, the privacy promise and the form", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("20-minute reminiscence session");
    await expect(page.getByTestId("agent-promise")).toContainText("every idea it suggests gets checked first");
    await expect(page.getByText("Nothing you type is stored").first()).toBeVisible();
    for (const slug of ["maria", "seamus", "fatima"]) await expect(page.getByTestId(`persona-${slug}`)).toBeVisible();
    await expect(page.getByTestId("custom-form")).toBeVisible();
    await expect(page.getByRole("contentinfo")).toContainText("not medical advice");
  });

  test("tapping Maria lands on the recorded replay by default (no live wait)", async ({ page }) => {
    // Live /api/session is not called at all; the landing card points straight at the fixture replay.
    let liveCalled = false;
    await page.route("**/api/session", (route) => {
      liveCalled = true;
      return route.fulfill({ status: 404 });
    });
    await page.goto("/");
    await page.getByTestId("persona-maria").click();
    await expect(page).toHaveURL(/\/session\?persona=maria&source=replay/);
    await expect(page.getByTestId("session-view")).toHaveAttribute("data-status", "done", { timeout: 25_000 });
    await expect(page.getByTestId("qloo-mode")).toContainText("Qloo: demo data");
    await expect(page.getByTestId("step-card")).toHaveCount(8);
    // "Run it live" is the visible escape hatch for a judge who wants the real agent.
    await expect(page.getByTestId("run-live")).toBeVisible();
    expect(liveCalled).toBe(false);
  });

  test("Run it live navigates to the live source and calls /api/session", async ({ page }) => {
    await mockStream(page, "/api/session", SAMPLE_GROUNDED_EVENTS);
    await page.goto("/session?persona=maria&source=replay");
    await expect(page.getByTestId("run-live")).toBeVisible();
    await page.getByTestId("run-live").click();
    await expect(page).toHaveURL(/\/session\?persona=maria(?!.*source=replay)/);
    await expect(page.getByTestId("session-view")).toHaveAttribute("data-status", "done");
    await expect(page.getByText("Live planner")).toBeVisible();
    await expect(page.getByTestId("qloo-mode")).toContainText("Qloo: demo data");
    await expect(page.getByTestId("step-card")).toHaveCount(8);
  });

  test("trace shows Qloo requests, verified entities, discoveries and rejections with reasons", async ({ page }) => {
    await page.goto("/session?persona=maria&source=sample&speed=40");
    await expect(page.getByTestId("session-view")).toHaveAttribute("data-status", "done");
    const trace = page.getByTestId("reasoning-trace");
    for (const phase of ["parse", "propose", "verify", "expand", "critique", "compose"])
      await expect(trace.locator(`[data-phase="${phase}"]`)).toHaveAttribute("data-status", "completed");
    await expect(trace.getByTestId("qloo-call")).toHaveCount(4);
    const insights = trace.getByTestId("qloo-call").filter({ hasText: "/v2/insights" }).first();
    await insights.locator("summary").click();
    await expect(insights).toContainText("signal.interests.entities");
    await expect(insights).toContainText("55_and_older");
    await expect(trace.getByTestId("trace-verified")).toHaveCount(9);
    // Maria's caregiver reads English chrome: "People who enjoy … also tend to enjoy …".
    await expect(trace.getByTestId("trace-discovery").first()).toContainText(
      "People who enjoy Frank Sinatra and Renato Carosone also tend to enjoy Peppino di Capri.",
    );
    const rejected = trace.getByTestId("trace-rejected");
    await expect(rejected).toHaveCount(4);
    await expect(rejected.filter({ hasText: "Diego Maradona" })).toContainText("Wrong era");
    // "Arrived in 1984" is a reason string on the sample event, not translated UI copy.
    await expect(rejected.filter({ hasText: "Diego Maradona" })).toContainText("Arrived in 1984");
  });

  test("plan step cards carry provenance, translation and language attributes", async ({ page }) => {
    await page.goto("/session?persona=maria&source=sample&speed=40");
    await expect(page.getByTestId("session-view")).toHaveAttribute("data-status", "done");
    const sinatra = page.locator('[data-step-id="s_sinatra"]');
    await expect(sinatra).toContainText("Verified in Qloo");
    await expect(sinatra.locator('[lang="it"]').first()).toContainText("Ascoltiamo Sinatra");
    await expect(sinatra.locator('[lang="en"]').first()).toContainText("Let's listen to Sinatra");
    await expect(page.locator('[data-step-id="s_peppino"]')).toContainText("Qloo discovery · 91%");
    await expect(page.locator('[data-step-id="s_ragu"]')).toContainText("Language model idea");
    await expect(page.getByTestId("session-title")).toHaveAttribute("lang", "it");
  });

  test("Seamus through the API path (fetch + NDJSON reader) with real images", async ({ page }) => {
    let request: SessionRequestDraft | undefined;
    const image = "https://images.example.test/sinatra.jpg";
    await page.route("https://images.example.test/**", (route) =>
      route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#a64"/></svg>',
      }),
    );
    const events = SAMPLE_GROUNDED_EVENTS.map((e) =>
      e.type === "plan"
        ? { ...e, plan: { ...e.plan, steps: e.plan.steps.map((s) => (s.entity ? { ...s, entity: { ...s.entity, imageUrl: image } } : s)) } }
        : e,
    );
    await mockStream(page, "/api/session", (body) => {
      request = body as SessionRequestDraft;
      return events;
    });
    await page.goto("/session?persona=seamus&source=api");
    await expect(page.getByTestId("session-view")).toHaveAttribute("data-status", "done");
    await expect(page.getByText("Live planner")).toBeVisible();
    expect(request?.person.birthPlace).toBe("Cork, Ireland");
    expect(request?.mode).toBe("grounded");
    await expect(page.locator('[data-step-id="s_sinatra"] img')).toHaveAttribute("src", image);
  });
});
