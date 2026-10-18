import { defineConfig } from "vitest/config";

export default defineConfig({
  // Resolves the "@/*" alias from tsconfig.json (native Vite support; replaces vite-tsconfig-paths).
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/contract/**/*.test.ts"],
    exclude: ["tests/e2e/**", "node_modules/**"],
    // Tests must never reach real providers: force mock mode regardless of .env.local.
    passWithNoTests: true,
    env: { REKINDLE_FORCE_MOCK: "true", LOG_LEVEL: "silent" },
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts"],
      exclude: ["src/lib/domain/sample-events.ts"],
    },
  },
});
