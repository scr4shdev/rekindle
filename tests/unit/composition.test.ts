import { describe, expect, it } from "vitest";

import { AiSdkLlm } from "@/lib/adapters/llm/ai-sdk";
import { MockLlm } from "@/lib/adapters/llm/mock";
import { QlooHttp } from "@/lib/adapters/qloo/http";
import { MockQloo } from "@/lib/adapters/qloo/mock";
import { buildAgentDeps, getAgentDeps } from "@/lib/composition";
import { loadConfig } from "@/lib/config";

describe("composition", () => {
  it("wires mocks and a memory cache without keys", () => {
    const deps = buildAgentDeps(loadConfig({ NODE_ENV: "test" }));
    expect(deps.taste).toBeInstanceOf(MockQloo);
    expect(deps.llm).toBeInstanceOf(MockLlm);
    expect(deps.cache.driver).toBe("memory");
    expect(deps.newId("ve")).toMatch(/^ve_[\w-]{10}$/);
    expect(deps.now()).toBeInstanceOf(Date);
  });

  it("switches each adapter to live purely by config", () => {
    const deps = buildAgentDeps(
      loadConfig({
        NODE_ENV: "test",
        QLOO_API_KEY: "qloo-key-123456",
        GROQ_API_KEY: "groq-key-123456",
        UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
        UPSTASH_REDIS_REST_TOKEN: "token-123456",
      }),
    );
    expect(deps.taste).toBeInstanceOf(QlooHttp);
    expect(deps.taste.mode).toBe("live");
    expect(deps.llm).toBeInstanceOf(AiSdkLlm);
    expect(deps.llm).toMatchObject({ provider: "groq", model: "openai/gpt-oss-120b" });
    expect(deps.cache.driver).toBe("layered");
  });

  it("memoizes the process-wide deps (forced mock in tests)", () => {
    const a = getAgentDeps();
    expect(getAgentDeps()).toBe(a);
    expect(a.taste.mode).toBe("mock");
  });
});
