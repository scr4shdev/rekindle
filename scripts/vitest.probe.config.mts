// Runs only the developer Qloo probe (scripts/qloo-probe.probe.ts). Not part of `npm run check`.
import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

function loadDotEnv(file: string): Record<string, string> {
  try {
    const text = readFileSync(file, "utf-8");
    const out: Record<string, string> = {};
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["scripts/**/*.probe.ts"],
    env: { LOG_LEVEL: "silent", ...loadDotEnv(".env.local") },
  },
});
