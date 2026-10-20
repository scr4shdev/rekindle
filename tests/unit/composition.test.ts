import { describe, expect, it } from "vitest";

import { AiSdkLlm } from "@/lib/adapters/llm/ai-sdk";
import { QlooHttp } from "@/lib/adapters/qloo/http";
import { MockQloo } from "@/lib/adapters/qloo/mock";
import { _resetAgentDepsForTests, buildAgentDeps, LlmNotConfiguredError, selectLlmBackend } from "@/lib/composition";
import { GEMINI_OPENAI_BASE_URL, loadConfig } from "@/lib/config";

/**
 * Composition has one happy path per branch:
 *   1. Gemini key set & LLM_PROVIDER !== "ollama" -> Gemini (OpenAI-compat).
 *   2. LLM_PROVIDER=ollama + reachable Ollama      -> Ollama (OpenAI-compat).
 *   3. Else                                        -> LlmNotConfiguredError.
 */
describe("composition fall-through", () => {
  it("branch 1: builds Gemini when GEMINI_API_KEY is set", () => {
    const config = loadConfig({ NODE_ENV: "test", GEMINI_API_KEY: "gemini-key-123456" });
    const picked = selectLlmBackend(config, false);
    expect(picked?.backend).toBe("gemini");
    expect(picked?.adapter.baseUrl).toBe(GEMINI_OPENAI_BASE_URL);
    expect(picked?.adapter.apiKey).toBe("gemini-key-123456");
    expect(picked?.adapter.model).toBe("gemini-3.1-flash-lite");

    const deps = buildAgentDeps(config);
    expect(deps.llm).toBeInstanceOf(AiSdkLlm);
    expect(deps.llm.provider).toBe("gemini");
    expect(deps.taste).toBeInstanceOf(MockQloo);
    expect(deps.cache.driver).toBe("memory");
    _resetAgentDepsForTests();
  });

  it("branch 1 wins over Ollama even when Ollama is reachable, unless LLM_PROVIDER=ollama overrides", () => {
    const config = loadConfig({ NODE_ENV: "test", GEMINI_API_KEY: "gemini-key-123456" });
    const picked = selectLlmBackend(config, true);
    expect(picked?.backend).toBe("gemini");
  });

  it("branch 2: builds Ollama when LLM_PROVIDER=ollama and the probe answers", () => {
    const config = loadConfig({ NODE_ENV: "test", LLM_PROVIDER: "ollama", LLM_MODEL: "qwen3:8b" });
    const picked = selectLlmBackend(config, true);
    expect(picked?.backend).toBe("ollama");
    expect(picked?.adapter.baseUrl).toBe("http://127.0.0.1:11434/v1");
    expect(picked?.adapter.apiKey).toBe("ollama");
    expect(picked?.adapter.model).toBe("qwen3:8b");

    const deps = buildAgentDeps(config, undefined, { ollamaReachable: true });
    expect(deps.llm).toBeInstanceOf(AiSdkLlm);
    expect(deps.llm.provider).toBe("ollama");
    _resetAgentDepsForTests();
  });

  it("branch 2 also fires with Gemini key present when LLM_PROVIDER=ollama is set explicitly", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      GEMINI_API_KEY: "gemini-key-123456",
      LLM_PROVIDER: "ollama",
      LLM_MODEL: "qwen3:8b",
    });
    const picked = selectLlmBackend(config, true);
    expect(picked?.backend).toBe("ollama");
  });

  it("branch 3: throws when no backend is available (no key, no probe)", () => {
    expect(() => buildAgentDeps(loadConfig({ NODE_ENV: "test" }))).toThrow(LlmNotConfiguredError);
  });

  it("branch 3: throws when LLM_PROVIDER=ollama but the probe fails", () => {
    const config = loadConfig({ NODE_ENV: "test", LLM_PROVIDER: "ollama" });
    expect(() => buildAgentDeps(config, undefined, { ollamaReachable: false })).toThrow(LlmNotConfiguredError);
  });

  it("LLM_BASE_URL_OVERRIDE short-circuits the derived base URL for Gemini", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      GEMINI_API_KEY: "gemini-key-123456",
      LLM_BASE_URL_OVERRIDE: "https://proxy.example.com/openai",
    });
    const picked = selectLlmBackend(config, false);
    expect(picked?.adapter.baseUrl).toBe("https://proxy.example.com/openai");
  });

  it("wires Qloo live when QLOO_API_KEY is present and layers in Upstash cache", () => {
    const deps = buildAgentDeps(
      loadConfig({
        NODE_ENV: "test",
        QLOO_API_KEY: "qloo-key-123456",
        GEMINI_API_KEY: "gemini-key-123456",
        UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
        UPSTASH_REDIS_REST_TOKEN: "token-123456",
      }),
    );
    expect(deps.taste).toBeInstanceOf(QlooHttp);
    expect(deps.taste.mode).toBe("live");
    expect(deps.cache.driver).toBe("layered");
    _resetAgentDepsForTests();
  });
});
