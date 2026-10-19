/**
 * Developer-only live probe for the Ollama LLM adapter. Never imported by the
 * app. Needs a running Ollama server (default http://127.0.0.1:11434) with
 * the configured model pulled.
 *
 *   npx vitest run --config scripts/vitest.probe.config.mts scripts/ollama-probe.probe.ts
 *
 * Reports:
 *  - one real round trip through OllamaLlm against the local server
 *  - schema conformance (parse-anchors style structured output)
 *  - round-trip latency
 *  - determinism: the same prompt run twice yields identical output
 */
import pino from "pino";
import { it } from "vitest";
import { z } from "zod";

import { MemoryCache } from "@/lib/adapters/cache";
import { OllamaLlm, isOllamaReachable } from "@/lib/adapters/llm/ollama";
import { loadConfig, OLLAMA_DEFAULT_BASE_URL, OLLAMA_DEFAULT_MODEL } from "@/lib/config";
import type { LlmRequest } from "@/lib/ports/llm";

const logger = pino({ level: "silent" });

const schema = z.object({
  birthYear: z.number().int(),
  birthPlaceCountryCode: z.string().describe("ISO 3166-1 alpha-2, uppercase."),
  likelyLanguage: z.string().describe("BCP 47 tag, lowercase."),
  summary: z.string().describe("One short sentence, no personal names."),
});

const SYSTEM =
  "You convert structured facts about a person into a tiny JSON object. " +
  "Return ONLY the JSON matching the schema. No prose, no commentary.";

const render = (input: { birthYear: number; birthPlace: string; language: string }) =>
  [
    `Birth year: ${input.birthYear}`,
    `Birth place: ${input.birthPlace}`,
    `Caregiver language: ${input.language}`,
  ].join("\n");

const INPUT = { birthYear: 1952, birthPlace: "Beirut, Lebanon", language: "en" };

const request: LlmRequest<z.infer<typeof schema>> = {
  promptId: "ollama-probe",
  version: "1.0.0",
  system: SYSTEM,
  prompt: render(INPUT),
  input: INPUT,
  schema,
};

it("ollama local probe: round trip, schema, determinism", { timeout: 180_000 }, async () => {
  const config = loadConfig({
    ...process.env,
    LLM_PROVIDER: "ollama",
  });
  const baseUrl = config.llm.ollamaBaseUrl ?? OLLAMA_DEFAULT_BASE_URL;
  const reachable = await isOllamaReachable(baseUrl);
  if (!reachable) {
    process.stdout.write(`ollama not reachable at ${baseUrl}: skipping probe.\n`);
    return;
  }
  const model = config.llm.mode === "live" ? config.llm.model : OLLAMA_DEFAULT_MODEL;
  process.stdout.write(`boot: ollama at ${baseUrl}, model=${model}\n`);

  const llm = new OllamaLlm(
    {
      mode: "live",
      provider: "ollama",
      model,
      baseUrl,
      temperature: 0,
      timeoutMs: 120_000,
      maxRetries: 1,
      cacheTtlSeconds: 0,
    },
    new MemoryCache(),
  );
  const ctx = { traceId: "ollama-probe", logger };

  const t0 = Date.now();
  const first = await llm.generateObject(request, ctx);
  const firstMs = Date.now() - t0;
  process.stdout.write(`first call: ${firstMs}ms, cached=${first.cached}\n`);
  process.stdout.write(`output: ${JSON.stringify(first.object)}\n`);

  // Second call: fresh cache so this is a real second inference.
  const llm2 = new OllamaLlm(
    {
      mode: "live",
      provider: "ollama",
      model,
      baseUrl,
      temperature: 0,
      timeoutMs: 120_000,
      maxRetries: 1,
      cacheTtlSeconds: 0,
    },
    new MemoryCache(),
  );
  const t1 = Date.now();
  const second = await llm2.generateObject(request, ctx);
  const secondMs = Date.now() - t1;
  process.stdout.write(`second call: ${secondMs}ms, cached=${second.cached}\n`);

  const deterministic = JSON.stringify(first.object) === JSON.stringify(second.object);
  process.stdout.write(`deterministic: ${deterministic}\n`);
  if (!deterministic) {
    process.stdout.write(`first:  ${JSON.stringify(first.object)}\n`);
    process.stdout.write(`second: ${JSON.stringify(second.object)}\n`);
  }
  process.stdout.write(
    `PROBE DONE: latencyMs=${firstMs}, deterministic=${deterministic}, model=${model}\n`,
  );
});
