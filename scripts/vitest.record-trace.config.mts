// Runs the trace recorder (scripts/record-trace.ts) against the live
// /api/session endpoint. GEMINI_API_KEY must be set in .env.local; the recorder
// reads it through the normal config path. Not part of `npm run check`.
//
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
    // No forced-mock env: the recorder runs the real Gemini + Qloo path.
    env: { LOG_LEVEL: "info" },
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
