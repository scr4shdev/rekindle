import { describe, expect, it } from "vitest";

import { ConfigError, loadConfig } from "@/lib/config";

describe("config", () => {
  it("falls back to mock mode when keys are empty", () => {
    const c = loadConfig({ QLOO_API_KEY: "", GEMINI_API_KEY: "", GROQ_API_KEY: "", ANTHROPIC_API_KEY: "" });
    expect(c.qloo.mode).toBe("mock");
    expect(c.qloo.mockReason).toBe("missing_key");
    expect(c.llm).toMatchObject({ mode: "mock", provider: "mock", temperature: 0 });
    expect(c.cache.driver).toBe("memory");
  });

  it("picks the first provider with a key and its pinned model", () => {
    const c = loadConfig({ GROQ_API_KEY: "gsk_test_key_123", QLOO_API_KEY: "qloo_test_key_123" });
    expect(c.llm).toMatchObject({ mode: "live", provider: "groq" });
    expect(c.qloo.mode).toBe("live");
    expect(c.qloo.baseUrl).toBe("https://hackathon.api.qloo.com");
  });

  it("REKINDLE_FORCE_MOCK overrides keys", () => {
    const c = loadConfig({ REKINDLE_FORCE_MOCK: "true", GROQ_API_KEY: "gsk_test_key_123", QLOO_API_KEY: "qloo_test_key_123" });
    expect([c.llm.mode, c.qloo.mode]).toEqual(["mock", "mock"]);
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
