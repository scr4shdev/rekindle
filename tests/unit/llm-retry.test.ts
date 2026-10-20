import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { MemoryCache } from "@/lib/adapters/cache";
import type { AiSdkLlmConfig } from "@/lib/adapters/llm/ai-sdk";
import { AiSdkLlm, classifyRetry, retryDelayMs } from "@/lib/adapters/llm/ai-sdk";
import { loadConfig } from "@/lib/config";
import type { LlmRequest } from "@/lib/ports/llm";

import { recordingLogger, testCtx } from "./helpers";

const config: AiSdkLlmConfig = {
  provider: "gemini",
  model: "gemini-test",
  baseUrl: "https://llm.example.test/v1beta/openai",
  apiKey: "test-key-123456",
  temperature: 0,
  timeoutMs: 5_000,
  retry: { maxAttempts: 3, baseDelayMs: 500 },
  cacheTtlSeconds: 60,
};

const schema = z.object({ answer: z.string(), score: z.number() });
const request: LlmRequest<{ answer: string; score: number }> = {
  promptId: "retry-prompt",
  version: "1.0.0",
  system: "system text",
  prompt: "user prompt with private notes",
  input: { notes: "private notes" },
  schema,
};

/** A 200 chat-completions body carrying `content` as the assistant message. */
function completion(content: string): Response {
  return Response.json({
    id: "cmpl-1",
    object: "chat.completion",
    created: 0,
    model: "gemini-test",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  });
}
const ok = () => completion('{"answer":"ok","score":1}');
const status = (code: number) => Response.json({ error: { message: "echoed private notes", code } }, { status: code });

let fetchMock: ReturnType<typeof vi.fn>;
function queue(...responses: Array<Response | Error>) {
  for (const r of responses) {
    fetchMock.mockImplementationOnce(async () => {
      if (r instanceof Error) throw r;
      return r;
    });
  }
}

/** Real model path (createLanguageModel -> fetch), fake sleep that records delays. */
function build(overrides: Partial<AiSdkLlmConfig> = {}) {
  const waits: number[] = [];
  const llm = new AiSdkLlm({ ...config, ...overrides }, new MemoryCache(), {
    sleep: async (ms) => void waits.push(ms),
    random: () => 0.5,
  });
  return { llm, waits };
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LLM retry policy", () => {
  it("retries a 500 and succeeds on the second attempt", async () => {
    queue(status(500), ok());
    const { llm, waits } = build();
    const { logger, lines } = recordingLogger();
    const result = await llm.generateObject(request, testCtx({ logger }));
    expect(result.object).toEqual({ answer: "ok", score: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(waits).toEqual([500]);

    const retryLine = lines.map((l) => JSON.parse(l)).find((l) => l.msg === "llm call retrying");
    expect(retryLine).toMatchObject({ level: 30, attempt: 1, maxAttempts: 3, reason: "5xx", status: 500, delayMs: 500 });
    const logged = lines.join("\n");
    expect(logged).not.toContain("private notes");
    expect(logged).not.toContain("test-key-123456");
  });

  it("retries 429 twice and succeeds on the third attempt", async () => {
    queue(status(429), status(429), ok());
    const { llm, waits } = build();
    const { logger, lines } = recordingLogger();
    const result = await llm.generateObject(request, testCtx({ logger }));
    expect(result.object.answer).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([500, 2000]);
    const reasons = lines.map((l) => JSON.parse(l)).filter((l) => l.msg === "llm call retrying").map((l) => l.reason);
    expect(reasons).toEqual(["429", "429"]);
  });

  it("retries a per-call timeout and succeeds on the next attempt", async () => {
    // Short per-call timeout so the AbortSignal.timeout fires before fetch can resolve.
    const { llm, waits } = build({ timeoutMs: 15 });
    fetchMock.mockImplementationOnce(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () =>
            reject(new DOMException("The operation was aborted.", "AbortError")),
          );
        }),
    );
    fetchMock.mockImplementationOnce(async () => ok());

    const { logger, lines } = recordingLogger();
    const result = await llm.generateObject(request, testCtx({ logger }));
    expect(result.object.answer).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(waits).toEqual([500]);
    const retryLine = lines.map((l) => JSON.parse(l)).find((l) => l.msg === "llm call retrying");
    expect(retryLine).toMatchObject({ reason: "timeout" });
  });

  it("retries a network error", async () => {
    queue(new TypeError("fetch failed"), ok());
    const { llm } = build();
    const { logger, lines } = recordingLogger();
    await llm.generateObject(request, testCtx({ logger }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryLine = lines.map((l) => JSON.parse(l)).find((l) => l.msg === "llm call retrying");
    expect(retryLine).toMatchObject({ reason: "network" });
  });

  it.each([400, 401, 403, 404])("does not retry a %i", async (code) => {
    queue(status(code), ok());
    const { llm, waits } = build();
    await expect(llm.generateObject(request, testCtx())).rejects.toMatchObject({ name: "PortError", port: "llm" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(waits).toEqual([]);
  });

  it("surfaces the error after three 500s", async () => {
    queue(status(500), status(500), status(500), ok());
    const { llm, waits } = build();
    await expect(llm.generateObject(request, testCtx())).rejects.toMatchObject({
      name: "PortError",
      port: "llm",
      code: "unavailable",
      retryable: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([500, 2000]);
  });

  it("retries a well-formed but empty object that fails the schema", async () => {
    queue(completion("{}"), ok());
    const { llm } = build();
    const { logger, lines } = recordingLogger();
    const result = await llm.generateObject(request, testCtx({ logger }));
    expect(result.object).toEqual({ answer: "ok", score: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryLine = lines.map((l) => JSON.parse(l)).find((l) => l.msg === "llm call retrying");
    expect(retryLine).toMatchObject({ reason: "empty_output" });
    expect(retryLine.status).toBeUndefined();
  });

  it("retries a zero-filled object that fails the schema", async () => {
    queue(completion('{"answer":"","score":"0"}'), completion("{}"), completion("{}"));
    const { llm } = build();
    await expect(llm.generateObject(request, testCtx())).rejects.toMatchObject({ code: "invalid_response" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("stops immediately when aborted during backoff", async () => {
    queue(status(500), ok());
    const controller = new AbortController();
    // Default sleep (node:timers/promises), long base delay: only the abort can end the wait.
    const llm = new AiSdkLlm({ ...config, retry: { maxAttempts: 3, baseDelayMs: 5_000 } }, new MemoryCache());
    const started = Date.now();
    const pending = llm.generateObject(request, testCtx({ signal: controller.signal }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    setTimeout(() => controller.abort(), 20);
    await expect(pending).rejects.toMatchObject({ code: "timeout", retryable: false });
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not sleep or call again when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const { llm, waits } = build();
    await expect(llm.generateObject(request, testCtx({ signal: controller.signal }))).rejects.toMatchObject({ code: "timeout" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(waits).toEqual([]);
  });

  it("honors maxAttempts = 1 (no retries)", async () => {
    queue(status(500), ok());
    const { llm } = build({ retry: { maxAttempts: 1, baseDelayMs: 500 } });
    await expect(llm.generateObject(request, testCtx())).rejects.toMatchObject({ code: "unavailable" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("retry helpers", () => {
  it("delays 500 ms then 2000 ms with +-25% jitter and a cap", () => {
    expect([1, 2].map((n) => retryDelayMs(n, 500, () => 0.5))).toEqual([500, 2000]);
    expect(retryDelayMs(1, 500, () => 0)).toBe(375);
    expect(retryDelayMs(1, 500, () => 1)).toBe(625);
    expect(retryDelayMs(2, 500, () => 1)).toBe(2500);
    expect(retryDelayMs(5, 500, () => 0.5)).toBe(4000);
    expect(retryDelayMs(1, 0)).toBe(0);
  });

  it("classifies nothing but transient failures as retryable", () => {
    expect(classifyRetry(new Error("boom"), true)).toEqual({ reason: "timeout" });
    expect(classifyRetry(Object.assign(new Error("a"), { name: "AbortError" }))).toBeUndefined();
    expect(classifyRetry(new TypeError("fetch failed"))).toEqual({ reason: "network" });
  });
});

describe("llm.retry config", () => {
  it("defaults to 3 attempts and 500 ms", () => {
    expect(loadConfig({}).llm.retry).toEqual({ maxAttempts: 3, baseDelayMs: 500 });
  });

  it("reads and clamps LLM_RETRY_* env vars", () => {
    const load = (a: string, b: string) => loadConfig({ LLM_RETRY_MAX_ATTEMPTS: a, LLM_RETRY_BASE_DELAY_MS: b }).llm.retry;
    expect(load("2", "100")).toEqual({ maxAttempts: 2, baseDelayMs: 100 });
    expect(load("0", "-5")).toEqual({ maxAttempts: 1, baseDelayMs: 0 });
    expect(load("99", "99999")).toEqual({ maxAttempts: 5, baseDelayMs: 5000 });
  });
});
