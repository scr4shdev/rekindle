import { expect, test } from "@playwright/test";

test.describe("/for-operators", () => {
  test("renders the six section headings, the CTA and the footer link", async ({ page }) => {
    const response = await page.goto("/for-operators");
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(/For care operators/);

    const headings = [
      "The buyer and the user",
      "The pain in numbers",
      "What Rekindle changes",
      "The pilot calendar",
      "Pricing hypothesis",
      "Why now",
    ];
    for (const heading of headings) {
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    }

    const cta = page.getByTestId("operators-cta");
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute("href", "mailto:pilot@rekindle.app");
    await expect(cta).toHaveText(/Email the team/);
  });

  test("is reachable from the global footer", async ({ page }) => {
    await page.goto("/");
    const link = page.getByTestId("footer-for-operators");
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/\/for-operators$/);
    await expect(page.getByRole("heading", { name: "The buyer and the user" })).toBeVisible();
  });
});
