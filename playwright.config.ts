import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  workers: 4,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    // CI runs `npm run build` first; locally the dev server is enough.
    command: isCI ? `npx next start -p ${PORT}` : `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !isCI,
    timeout: 120_000,
    // E2E always runs against mock adapters: no keys, no network.
    env: { REKINDLE_FORCE_MOCK: "true", LOG_LEVEL: "warn" },
  },
});
