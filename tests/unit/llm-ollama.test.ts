import { describe, expect, it } from "vitest";
import { z } from "zod";

import { MemoryCache } from "@/lib/adapters/cache";
import type { Fetcher, LiveOllamaConfig } from "@/lib/adapters/llm/ollama";
import {
  isOllamaReachable,
  OLLAMA_NUM_CTX,
  OLLAMA_SEED,
  OllamaLlm,
  schemaToJsonSchema,
  toPortError,
} from "@/lib/adapters/llm/ollama";
import { PortError } from "@/lib/ports/common";
import type { LlmRequest } from "@/lib/ports/llm";

import { recordingLogger, testCtx } from "./helpers";

const config: LiveOllamaConfig = {
  mode: "live",
  provider: "ollama",
  model: "qwen3:8b",
  baseUrl: "http://127.0.0.1:11434",
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

const noSleep = async () => {};

function okChat(content: string) {
  return new Response(
    JSON.stringify({
      model: config.model,
      message: { role: "assistant", content },
      done: true,
      prompt_eval_count: 11,
      eval_count: 7,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function captureFetcher(bodies: unknown[], response: () => Response | Promise<Response>): Fetcher {
  return async (url, init) => {
    bodies.push({ url, body: init.body ? JSON.parse(String(init.body)) : undefined });
    return response();
  };
}

describe("OllamaLlm", () => {
  it("sends the right request body and parses a schema-valid response", async () => {
    const bodies: unknown[] = [];
    const fetcher = captureFetcher(bodies, () => okChat('{"answer":"ok"}'));
    const cache = new MemoryCache();
    const llm = new OllamaLlm(config, cache, { fetcher, sleep: noSleep });
    const { logger, lines } = recordingLogger();

    const first = await llm.generateObject(request, testCtx({ logger }));
    expect(first).toMatchObject({
      object: { answer: "ok" },
      cached: false,
      provider: "ollama",
      model: "qwen3:8b",
    });
    expect(first.usage).toEqual({ inputTokens: 11, outputTokens: 7 });

    expect(bodies).toHaveLength(1);
    const { url, body } = bodies[0] as { url: string; body: Record<string, unknown> };
    expect(url).toBe("http://127.0.0.1:11434/api/chat");
    expect(body.model).toBe("qwen3:8b");
    expect(body.stream).toBe(false);
    expect(body.think).toBe(false);
    expect(body.options).toMatchObject({ temperature: 0, seed: OLLAMA_SEED, num_ctx: OLLAMA_NUM_CTX });
    expect(body.messages).toEqual([
      { role: "system", content: "system text" },
      { role: "user", content: "user prompt with private notes" },
    ]);
    const format = body.format as Record<string, unknown>;
    expect(format.type).toBe("object");
    expect(format.properties).toMatchObject({ answer: { type: "string" } });
    expect(format.required).toContain("answer");

    // Cached on the second call.
    const second = await llm.generateObject(request, testCtx({ logger }));
    expect(second.cached).toBe(true);
    expect(bodies).toHaveLength(1);

    const logged = lines.join("\n");
    expect(logged).toContain("test-prompt");
    expect(logged).not.toContain("private notes");
    expect(logged).not.toContain("user prompt");
  });

  it("retries an invalid structure, then succeeds", async () => {
    const bodies: unknown[] = [];
    let call = 0;
    const fetcher = captureFetcher(bodies, () => {
      call += 1;
      return call === 1 ? okChat('{"wrong":1}') : okChat('{"answer":"second"}');
    });
    const llm = new OllamaLlm(config, new MemoryCache(), { fetcher, sleep: noSleep });
    const result = await llm.generateObject(request, testCtx());
    expect(result.object.answer).toBe("second");
    expect(bodies).toHaveLength(2);
  });

  it("retries non-JSON content, then succeeds", async () => {
    let call = 0;
    const fetcher: Fetcher = async () => {
      call += 1;
      return call === 1 ? okChat("not json") : okChat('{"answer":"recovered"}');
    };
    const llm = new OllamaLlm(config, new MemoryCache(), { fetcher, sleep: noSleep });
    const result = await llm.generateObject(request, testCtx());
    expect(result.object.answer).toBe("recovered");
  });

  it("maps a 5xx to a retryable unavailable PortError", async () => {
    const fetcher: Fetcher = async () => new Response("boom", { status: 503 });
    const llm = new OllamaLlm({ ...config, maxRetries: 0 }, new MemoryCache(), { fetcher, sleep: noSleep });
    await expect(llm.generateObject(request, testCtx())).rejects.toMatchObject({
      name: "PortError",
      code: "unavailable",
      retryable: true,
    });
  });

  it("maps a 400 to a non-retryable bad_request", async () => {
    const fetcher: Fetcher = async () => new Response("bad", { status: 400 });
    const llm = new OllamaLlm(config, new MemoryCache(), { fetcher, sleep: noSleep });
    await expect(llm.generateObject(request, testCtx())).rejects.toMatchObject({
      code: "bad_request",
      retryable: false,
    });
  });

  it("maps connection refused to retryable unavailable", async () => {
    const fetcher: Fetcher = async () => {
      throw new TypeError("fetch failed: ECONNREFUSED");
    };
    const llm = new OllamaLlm({ ...config, maxRetries: 0 }, new MemoryCache(), { fetcher, sleep: noSleep });
    await expect(llm.generateObject(request, testCtx())).rejects.toMatchObject({
      code: "unavailable",
      retryable: true,
    });
  });

  it("stops retrying when the caller signal aborts", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetcher: Fetcher = async () => okChat('{"answer":"ignored"}');
    const llm = new OllamaLlm(config, new MemoryCache(), { fetcher, sleep: noSleep });
    await expect(llm.generateObject(request, testCtx({ signal: controller.signal }))).rejects.toMatchObject({
      code: "timeout",
      retryable: false,
    });
  });

  it("surfaces a timeout as retryable PortError(code:timeout) when the fetch never resolves", async () => {
    // The internal AbortSignal.timeout fires at timeoutMs and the fetcher
    // rejects with the DOMException it dispatches. We short-circuit the
    // backoff sleep so maxRetries=0 exhausts in one attempt.
    const fetcher: Fetcher = (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init.signal as AbortSignal | undefined;
        if (!signal) return;
        signal.addEventListener("abort", () =>
          reject(Object.assign(new Error("The operation timed out."), { name: "TimeoutError" })),
        );
      });
    const llm = new OllamaLlm({ ...config, maxRetries: 0, timeoutMs: 10 }, new MemoryCache(), {
      fetcher,
      sleep: noSleep,
    });
    await expect(llm.generateObject(request, testCtx())).rejects.toMatchObject({
      name: "PortError",
      code: "timeout",
      retryable: true,
    });
  });

  it("backs off exponentially between retries and stops sleeping when aborted mid-backoff", async () => {
    const waits: number[] = [];
    const sleep = async (ms: number) => void waits.push(ms);
    const fetcher: Fetcher = async () => new Response("boom", { status: 503 });
    const llm = new OllamaLlm({ ...config, maxRetries: 3 }, new MemoryCache(), { fetcher, sleep });
    await expect(llm.generateObject(request, testCtx())).rejects.toMatchObject({ code: "unavailable" });
    expect(waits).toEqual([300, 600, 1200]);

    const controller = new AbortController();
    const slow = new OllamaLlm({ ...config, maxRetries: 3 }, new MemoryCache(), {
      fetcher: async () => new Response("boom", { status: 503 }),
      sleep: async () => controller.abort(),
    });
    await expect(slow.generateObject(request, testCtx({ signal: controller.signal }))).rejects.toMatchObject({
      code: "timeout",
    });
  });

  it("maps a 404 (model not pulled) to a non-retryable unavailable", async () => {
    const fetcher: Fetcher = async () => new Response("model not found", { status: 404 });
    const llm = new OllamaLlm({ ...config, maxRetries: 0 }, new MemoryCache(), { fetcher, sleep: noSleep });
    await expect(llm.generateObject(request, testCtx())).rejects.toMatchObject({
      name: "PortError",
      code: "unavailable",
      retryable: false,
    });
  });
});

describe("schemaToJsonSchema", () => {
  it("converts a nested zod schema and strips $schema", () => {
    const s = z.object({
      items: z.array(z.object({ name: z.string(), year: z.number().int() })).min(1),
      note: z.string().optional(),
    });
    const json = schemaToJsonSchema(s);
    expect(json.$schema).toBeUndefined();
    expect(json.type).toBe("object");
    expect((json.properties as Record<string, unknown>).items).toMatchObject({ type: "array" });
  });
});

describe("isOllamaReachable", () => {
  it("returns true on a 200 response", async () => {
    const fetcher: Fetcher = async () => new Response("{}", { status: 200 });
    expect(await isOllamaReachable("http://127.0.0.1:11434", { fetcher })).toBe(true);
  });

  it("returns false when the fetcher throws", async () => {
    const fetcher: Fetcher = async () => {
      throw new Error("boom");
    };
    expect(await isOllamaReachable("http://127.0.0.1:11434", { fetcher })).toBe(false);
  });

  it("returns false on a non-ok response", async () => {
    const fetcher: Fetcher = async () => new Response("nope", { status: 500 });
    expect(await isOllamaReachable("http://127.0.0.1:11434", { fetcher })).toBe(false);
  });
});

describe("toPortError", () => {
  it("passes through PortError", () => {
    const original = new PortError("llm", "bad_request", "x", false);
    expect(toPortError(original)).toBe(original);
  });
});
