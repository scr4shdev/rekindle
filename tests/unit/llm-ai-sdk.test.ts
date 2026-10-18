import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { MemoryCache } from "@/lib/adapters/cache";
import type { LiveLlmConfig } from "@/lib/adapters/llm/ai-sdk";
import { AiSdkLlm, createLanguageModel, toPortError } from "@/lib/adapters/llm/ai-sdk";
import { PortError } from "@/lib/ports/common";
import type { LlmRequest } from "@/lib/ports/llm";

import { recordingLogger, testCtx } from "./helpers";

const config: LiveLlmConfig = {
  mode: "live",
  provider: "gemini",
  model: "gemini-test",
  apiKey: "test-key-123456",
  temperature: 0,
  timeoutMs: 5_000,
  maxRetries: 1,
  cacheTtlSeconds: 60,
};

const schema = z.object({ answer: z.string() });
const request: LlmRequest<{ answer: string }> = {
  promptId: "test-prompt",
  version: "1.0.0",
  system: "system text",
  prompt: "user prompt with private notes",
  input: { notes: "private notes" },
  schema,
};

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

function textResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
    finishReason: { unified: "stop" as const, raw: undefined },
    usage,
    warnings: [],
  };
}

describe("AiSdkLlm", () => {
  it("generates a schema-valid object at temperature 0 and caches it", async () => {
    const model = new MockLanguageModelV4({ doGenerate: async () => textResult('{"answer":"ok"}') });
    const cache = new MemoryCache();
    const llm = new AiSdkLlm(config, cache, { languageModel: model });
    const { logger, lines } = recordingLogger();

    const first = await llm.generateObject(request, testCtx({ logger }));
    expect(first).toMatchObject({ object: { answer: "ok" }, cached: false, provider: "gemini", model: "gemini-test" });
    expect(first.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(model.doGenerateCalls[0].temperature).toBe(0);

    const second = await llm.generateObject(request, testCtx({ logger }));
    expect(second.cached).toBe(true);
    expect(model.doGenerateCalls).toHaveLength(1);

    const logged = lines.join("\n");
    expect(logged).toContain("test-prompt");
    expect(logged).not.toContain("private notes");
    expect(logged).not.toContain("user prompt");
  });

  it("retries an invalid structure, then succeeds", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: [textResult('{"wrong":1}'), textResult('{"answer":"second"}')],
    });
    const llm = new AiSdkLlm(config, new MemoryCache(), { languageModel: model });
    const result = await llm.generateObject(request, testCtx());
    expect(result.object.answer).toBe("second");
    expect(model.doGenerateCalls).toHaveLength(2);
  });

  it("throws PortError(llm, invalid_response) after exhausting retries", async () => {
    const model = new MockLanguageModelV4({ doGenerate: async () => textResult("not json") });
    const llm = new AiSdkLlm(config, new MemoryCache(), { languageModel: model });
    await expect(llm.generateObject(request, testCtx())).rejects.toMatchObject({
      name: "PortError",
      port: "llm",
      code: "invalid_response",
    });
    expect(model.doGenerateCalls).toHaveLength(2);
  });

  it("does not retry unauthorized errors", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new APICallError({ message: "bad key", url: "https://x", requestBodyValues: {}, statusCode: 401 });
      },
    });
    const llm = new AiSdkLlm(config, new MemoryCache(), { languageModel: model });
    await expect(llm.generateObject(request, testCtx())).rejects.toMatchObject({ code: "unauthorized" });
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it("stops when the caller aborts", async () => {
    const controller = new AbortController();
    controller.abort();
    const model = new MockLanguageModelV4({ doGenerate: async () => textResult('{"answer":"x"}') });
    const llm = new AiSdkLlm(config, new MemoryCache(), { languageModel: model });
    await expect(llm.generateObject(request, testCtx({ signal: controller.signal }))).rejects.toMatchObject({ code: "timeout" });
  });

  it("ignores a cached value that no longer matches the schema", async () => {
    const cache = new MemoryCache();
    const model = new MockLanguageModelV4({ doGenerate: async () => textResult('{"answer":"fresh"}') });
    const llm = new AiSdkLlm(config, cache, { languageModel: model });
    await llm.generateObject(request, testCtx());
    const other = { ...request, schema: z.object({ answer: z.number() }) } as unknown as LlmRequest<{ answer: string }>;
    await expect(llm.generateObject(other, testCtx())).rejects.toBeInstanceOf(PortError);
  });
});

describe("toPortError", () => {
  const api = (statusCode: number) => new APICallError({ message: "m", url: "u", requestBodyValues: {}, statusCode });
  it("maps statuses and timeouts", () => {
    expect(toPortError(api(429)).code).toBe("rate_limited");
    expect(toPortError(api(400)).code).toBe("bad_request");
    expect(toPortError(api(503))).toMatchObject({ code: "unavailable", retryable: true });
    expect(toPortError(new Error("x"), true).code).toBe("timeout");
    expect(toPortError(Object.assign(new Error("a"), { name: "AbortError" })).code).toBe("timeout");
    expect(toPortError(new Error("other")).code).toBe("unavailable");
  });
});

describe("createLanguageModel", () => {
  it("builds each provider with the configured model id", () => {
    for (const provider of ["gemini", "groq", "anthropic"] as const) {
      const model = createLanguageModel({ ...config, provider, model: `${provider}-m` });
      expect(typeof model === "object" && model.modelId).toBe(`${provider}-m`);
    }
  });
});
