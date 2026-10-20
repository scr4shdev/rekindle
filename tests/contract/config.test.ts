import { describe, expect, it } from "vitest";

import { ConfigError, DEFAULT_LLM_MODEL, loadConfig, OLLAMA_DEFAULT_MODEL } from "@/lib/config";

describe("config", () => {
  it("falls back to mock mode when GEMINI_API_KEY is empty and no provider is requested", () => {
    const c = loadConfig({ QLOO_API_KEY: "", GEMINI_API_KEY: "" });
    expect(c.qloo.mode).toBe("mock");
    expect(c.qloo.mockReason).toBe("missing_key");
    expect(c.llm).toMatchObject({ mode: "mock", provider: "mock", temperature: 0 });
    expect(c.cache.driver).toBe("memory");
  });

  it("picks Gemini when GEMINI_API_KEY is set and defaults the model to gemini-3.1-flash-lite", () => {
    const c = loadConfig({ GEMINI_API_KEY: "gemini_test_key_123", QLOO_API_KEY: "qloo_test_key_123" });
    expect(c.llm).toMatchObject({ mode: "live", provider: "gemini", model: DEFAULT_LLM_MODEL });
    expect(c.qloo.mode).toBe("live");
    expect(c.qloo.baseUrl).toBe("https://hackathon.api.qloo.com");
  });

  it("opts into Ollama when LLM_PROVIDER=ollama (no key needed) and defaults model to qwen3:8b", () => {
    const c = loadConfig({ LLM_PROVIDER: "ollama" });
    expect(c.llm).toMatchObject({ mode: "live", provider: "ollama", model: OLLAMA_DEFAULT_MODEL });
  });

  it("REKINDLE_FORCE_MOCK overrides keys", () => {
    const c = loadConfig({ REKINDLE_FORCE_MOCK: "true", GEMINI_API_KEY: "gemini_test_key_123", QLOO_API_KEY: "qloo_test_key_123" });
    expect([c.llm.mode, c.qloo.mode]).toEqual(["mock", "mock"]);
  });

  it("LLM_MODEL overrides the per-backend default", () => {
    const c = loadConfig({ GEMINI_API_KEY: "gemini_test_key_123", LLM_MODEL: "gemini-2.5-flash" });
    expect(c.llm.model).toBe("gemini-2.5-flash");
  });

  it("LLM_BASE_URL_OVERRIDE flows into AppConfig for the adapter to pick up", () => {
    const c = loadConfig({ GEMINI_API_KEY: "gemini_test_key_123", LLM_BASE_URL_OVERRIDE: "https://proxy.example.com/openai" });
    expect(c.llm.baseUrlOverride).toBe("https://proxy.example.com/openai");
  });

  it("fails fast on invalid values without echoing them", () => {
    expect(() => loadConfig({ LLM_PROVIDER: "openai" })).toThrow(ConfigError);
    expect(() => loadConfig({ QLOO_TIMEOUT_MS: "fast" })).toThrow(ConfigError);
    expect(() => loadConfig({ UPSTASH_REDIS_REST_URL: "https://x.upstash.io" })).toThrow(ConfigError);
    try {
      loadConfig({ QLOO_BASE_URL: "not a url sk-secret" });
    } catch (e) {
      expect(String(e)).not.toContain("sk-secret");
    }
  });
});
