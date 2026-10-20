import { describe, expect, it } from "vitest";

import { AiSdkLlm } from "@/lib/adapters/llm/ai-sdk";
import { QlooHttp } from "@/lib/adapters/qloo/http";
import { MockQloo } from "@/lib/adapters/qloo/mock";
import { _resetAgentDepsForTests, buildAgentDeps, LlmNotConfiguredError } from "@/lib/composition";
import { loadConfig } from "@/lib/config";

/**
 * Composition is Gemini-only. If GEMINI_API_KEY is absent, buildAgentDeps
 * throws LlmNotConfiguredError. There is no silent fallback to Mock or
 * Ollama (those adapters have been deleted).
 */
describe("composition (Gemini-only)", () => {
  it("throws LlmNotConfiguredError when no hosted LLM key is present", () => {
    expect(() => buildAgentDeps(loadConfig({ NODE_ENV: "test" }))).toThrow(LlmNotConfiguredError);
  });

  it("wires Gemini + MockQloo (no QLOO_API_KEY) + memory cache", () => {
    const deps = buildAgentDeps(
      loadConfig({
        NODE_ENV: "test",
        GEMINI_API_KEY: "gemini-key-123456",
      }),
    );
    expect(deps.taste).toBeInstanceOf(MockQloo);
    expect(deps.llm).toBeInstanceOf(AiSdkLlm);
    expect(deps.llm).toMatchObject({ provider: "gemini" });
    expect(deps.cache.driver).toBe("memory");
    expect(deps.newId("ve")).toMatch(/^ve_[\w-]{10}$/);
    expect(deps.now()).toBeInstanceOf(Date);
  });

  it("switches each adapter to live purely by config", () => {
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
    expect(deps.llm).toBeInstanceOf(AiSdkLlm);
    expect(deps.llm).toMatchObject({ provider: "gemini" });
    expect(deps.cache.driver).toBe("layered");
    _resetAgentDepsForTests();
  });

  it("throws when a non-gemini provider is configured (groq, anthropic no longer supported in composition)", () => {
    expect(() =>
      buildAgentDeps(loadConfig({ NODE_ENV: "test", GROQ_API_KEY: "groq-key-123456", LLM_PROVIDER: "groq" })),
    ).toThrow(LlmNotConfiguredError);
    expect(() =>
      buildAgentDeps(
        loadConfig({ NODE_ENV: "test", ANTHROPIC_API_KEY: "anthropic-key-123456", LLM_PROVIDER: "anthropic" }),
      ),
    ).toThrow(LlmNotConfiguredError);
  });
});
