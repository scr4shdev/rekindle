import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { MemoryCache } from "@/lib/adapters/cache";
import type { AiSdkLlmConfig } from "@/lib/adapters/llm/ai-sdk";
import { AiSdkLlm, createLanguageModel, toPortError } from "@/lib/adapters/llm/ai-sdk";
import { PortError } from "@/lib/ports/common";
import type { LlmRequest } from "@/lib/ports/llm";

import { recordingLogger, testCtx } from "./helpers";

const geminiConfig: AiSdkLlmConfig = {
  provider: "gemini",
  model: "gemini-test",
  baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
  apiKey: "test-key-123456",
  temperature: 0,
  timeoutMs: 5_000,
  retry: { maxAttempts: 2, baseDelayMs: 300 },
  cacheTtlSeconds: 60,
};

const ollamaConfig: AiSdkLlmConfig = {
  ...geminiConfig,
  provider: "ollama",
  model: "qwen3:8b",
  baseUrl: "http://127.0.0.1:11434/v1",
  apiKey: "ollama",
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

const noSleep = async () => {};

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

describe("AiSdkLlm (OpenAI-compat)", () => {
  it("generates a schema-valid object at temperature 0 and caches it", async () => {
    const model = new MockLanguageModelV4({ doGenerate: async () => textResult('{"answer":"ok"}') });
    const cache = new MemoryCache();
    const llm = new AiSdkLlm(geminiConfig, cache, { languageModel: model, sleep: noSleep });
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
    // Logs the EFFECTIVE backend host so we can tell which endpoint served.
    expect(logged).toContain("generativelanguage.googleapis.com");
  });

  it("works the same way against an Ollama OpenAI-compat endpoint (just a different baseUrl)", async () => {
    const model = new MockLanguageModelV4({ doGenerate: async () => textResult('{"answer":"ok"}') });
    const cache = new MemoryCache();
    const llm = new AiSdkLlm(ollamaConfig, cache, { languageModel: model, sleep: noSleep });
    const { logger, lines } = recordingLogger();

    const result = await llm.generateObject(request, testCtx({ logger }));
    expect(result).toMatchObject({ object: { answer: "ok" }, cached: false, provider: "ollama", model: "qwen3:8b" });
    const logged = lines.join("\n");
    expect(logged).toContain("127.0.0.1:11434");
  });

  it("retries an invalid structure, then succeeds", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: [textResult('{"wrong":1}'), textResult('{"answer":"second"}')],
    });
    const llm = new AiSdkLlm(geminiConfig, new MemoryCache(), { languageModel: model, sleep: noSleep });
    const result = await llm.generateObject(request, testCtx());
    expect(result.object.answer).toBe("second");
    expect(model.doGenerateCalls).toHaveLength(2);
  });

  it("backs off x4 between retries (capped) and stops waiting when aborted", async () => {
    const waits: number[] = [];
    const sleep = async (ms: number) => void waits.push(ms);
    const model = new MockLanguageModelV4({ doGenerate: async () => textResult("not json") });
    const llm = new AiSdkLlm({ ...geminiConfig, retry: { maxAttempts: 4, baseDelayMs: 300 } }, new MemoryCache(), {
      languageModel: model,
      sleep,
      random: () => 0.5,
    });
    await expect(llm.generateObject(request, testCtx())).rejects.toMatchObject({ code: "invalid_response" });
    expect(waits).toEqual([300, 1200, 4000]);

    const controller = new AbortController();
    const slow = new AiSdkLlm({ ...geminiConfig, retry: { maxAttempts: 4, baseDelayMs: 300 } }, new MemoryCache(), {
      languageModel: new MockLanguageModelV4({ doGenerate: async () => textResult("not json") }),
      sleep: async () => controller.abort(),
    });
    await expect(slow.generateObject(request, testCtx({ signal: controller.signal }))).rejects.toMatchObject({ code: "timeout" });
  });

  it("retries on 429 (rate_limited) and surfaces the code to callers", async () => {
    let calls = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        calls += 1;
        if (calls === 1) {
          throw new APICallError({ message: "slow down", url: "https://x", requestBodyValues: {}, statusCode: 429 });
        }
        return textResult('{"answer":"after retry"}');
      },
    });
    const llm = new AiSdkLlm(geminiConfig, new MemoryCache(), { languageModel: model, sleep: noSleep });
    const result = await llm.generateObject(request, testCtx());
    expect(result.object.answer).toBe("after retry");
    expect(calls).toBe(2);
  });

  it("throws PortError(llm, invalid_response) after exhausting retries", async () => {
    const model = new MockLanguageModelV4({ doGenerate: async () => textResult("not json") });
    const llm = new AiSdkLlm(geminiConfig, new MemoryCache(), { languageModel: model, sleep: noSleep });
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
    const llm = new AiSdkLlm(geminiConfig, new MemoryCache(), { languageModel: model, sleep: noSleep });
    await expect(llm.generateObject(request, testCtx())).rejects.toMatchObject({ code: "unauthorized" });
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it("stops when the caller aborts", async () => {
    const controller = new AbortController();
    controller.abort();
    const model = new MockLanguageModelV4({ doGenerate: async () => textResult('{"answer":"x"}') });
    const llm = new AiSdkLlm(geminiConfig, new MemoryCache(), { languageModel: model, sleep: noSleep });
    await expect(llm.generateObject(request, testCtx({ signal: controller.signal }))).rejects.toMatchObject({ code: "timeout" });
  });

  it("ignores a cached value that no longer matches the schema", async () => {
    const cache = new MemoryCache();
    const model = new MockLanguageModelV4({ doGenerate: async () => textResult('{"answer":"fresh"}') });
    const llm = new AiSdkLlm(geminiConfig, cache, { languageModel: model, sleep: noSleep });
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
  it("builds a provider-agnostic LanguageModel against any OpenAI-compat baseUrl", () => {
    const g = createLanguageModel(geminiConfig);
    const o = createLanguageModel(ollamaConfig);
    expect(typeof g === "object" && g.modelId).toBe("gemini-test");
    expect(typeof o === "object" && o.modelId).toBe("qwen3:8b");
  });
});
