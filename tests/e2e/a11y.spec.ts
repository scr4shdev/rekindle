import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function audit(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .exclude("nextjs-portal")
    .analyze();
  const serious = results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.help} -> ${v.nodes.map((n) => n.target.join(" ")).slice(0, 4).join(" | ")}`);
  expect(serious, serious.join("\n")).toEqual([]);
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`accessibility (${scheme})`, () => {
    test.use({ colorScheme: scheme });

    test("landing", async ({ page }) => {
      await page.goto("/");
      await page.waitForSelector("[data-testid=custom-form]");
      await page.waitForTimeout(800); // let entrance animations settle
      await audit(page);
    });

    test("landing form with errors", async ({ page }) => {
      await page.goto("/");
      await page.getByRole("button", { name: "Plan the session" }).click();
      await expect(page.getByTestId("custom-form").getByRole("alert")).toBeVisible();
      await audit(page);
    });

    test("session with trace and plan", async ({ page }) => {
      await page.goto("/session?persona=maria&source=sample&speed=40");
      await expect(page.getByTestId("session-view")).toHaveAttribute("data-status", "done");
      await page.getByTestId("qloo-call").first().locator("summary").click();
      await page.waitForTimeout(800);
      await audit(page);
    });

    test("session mode", async ({ page }) => {
      await page.goto("/session?persona=maria&source=sample&speed=40");
      await expect(page.getByTestId("session-view")).toHaveAttribute("data-status", "done");
      await page.getByTestId("start-live").click();
      await page.getByTestId("react-lit_up").click();
      await page.waitForTimeout(800);
      await audit(page);
    });

    test("comparison", async ({ page }) => {
      await page.goto("/compare?persona=maria&source=sample&speed=40");
      await expect(page.getByTestId("compare-view")).toHaveAttribute("data-grounded-status", "done");
      await page.waitForTimeout(800);
      await audit(page);
    });
  });
}
