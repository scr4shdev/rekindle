// Runs only the developer Qloo probe (scripts/qloo-probe.probe.ts). Not part of `npm run check`.
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["scripts/**/*.probe.ts"],
    env: { LOG_LEVEL: "silent" },
  },
});
