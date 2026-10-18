import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const adapterImports = {
  group: ["@/lib/adapters", "@/lib/adapters/*", "@/lib/composition", "**/adapters/**"],
  message: "Depend on ports (src/lib/ports), not adapters. Only src/lib/composition.ts wires adapters.",
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Use the pino logger from @/lib/logger. Never console.*.
      "no-console": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  {
    // Architecture boundary: the agent loop and contracts depend only on ports + domain.
    files: ["src/lib/agent/**", "src/lib/domain/**", "src/lib/ports/**", "src/lib/prompts/**"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [adapterImports] }],
    },
  },
  {
    // Client UI must never import server-side adapters, config secrets or the agent.
    files: ["src/components/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            adapterImports,
            { group: ["@/lib/agent", "@/lib/agent/*", "@/lib/config", "@/lib/logger"], message: "Server-only module. UI talks to /api/* and uses @/lib/domain types." },
          ],
        },
      ],
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
