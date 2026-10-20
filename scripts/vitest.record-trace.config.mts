// Runs the trace recorder (scripts/record-trace.ts). Not part of `npm run check`.
// Invoke:
//   PERSONA=maria   npx vitest run --config scripts/vitest.record-trace.config.mts
//   PERSONA=fatima  npx vitest run --config scripts/vitest.record-trace.config.mts
//   PERSONA=seamus  npx vitest run --config scripts/vitest.record-trace.config.mts
//   PERSONA=all     npx vitest run --config scripts/vitest.record-trace.config.mts
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["scripts/record-trace.ts"],
    env: { REKINDLE_FORCE_MOCK: "true", LOG_LEVEL: "silent" },
  },
});
