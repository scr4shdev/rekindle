import { describe, expect, it } from "vitest";

import { AiSdkLlm } from "@/lib/adapters/llm/ai-sdk";
import { MockLlm } from "@/lib/adapters/llm/mock";
import { OllamaLlm } from "@/lib/adapters/llm/ollama";
import { QlooHttp } from "@/lib/adapters/qloo/http";
import { MockQloo } from "@/lib/adapters/qloo/mock";
import { _resetAgentDepsForTests, buildAgentDeps, getAgentDeps, getAgentDepsAsync } from "@/lib/composition";
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

  it("wires the Ollama adapter when LLM_PROVIDER=ollama", () => {
    const deps = buildAgentDeps(
      loadConfig({
        NODE_ENV: "test",
        LLM_PROVIDER: "ollama",
        OLLAMA_BASE_URL: "http://127.0.0.1:11434",
        OLLAMA_MODEL: "qwen3:8b",
      }),
    );
    expect(deps.llm).toBeInstanceOf(OllamaLlm);
    expect(deps.llm).toMatchObject({ provider: "ollama", model: "qwen3:8b" });
  });

  it("memoizes the process-wide deps (forced mock in tests)", () => {
    const a = getAgentDeps();
    expect(getAgentDeps()).toBe(a);
    expect(a.taste.mode).toBe("mock");
  });
});

describe("getAgentDepsAsync (Ollama probe branches)", () => {
  const ollamaConfig = () =>
    loadConfig({
      NODE_ENV: "test",
      LLM_PROVIDER: "ollama",
      OLLAMA_BASE_URL: "http://127.0.0.1:11434",
      OLLAMA_MODEL: "qwen3:8b",
    });

  it("downgrades to MockLlm with mockReason=unreachable when LLM_PROVIDER=ollama but the probe fails", async () => {
    _resetAgentDepsForTests();
    const calls: string[] = [];
    const probe = async (baseUrl: string) => {
      calls.push(baseUrl);
      return false;
    };
    const d = await getAgentDepsAsync({ config: ollamaConfig(), probe });
    expect(calls).toEqual(["http://127.0.0.1:11434"]);
    expect(d.llm).toBeInstanceOf(MockLlm);
    expect(d.config.llm).toMatchObject({ mode: "mock", mockReason: "unreachable", provider: "mock" });
    _resetAgentDepsForTests();
  });

  it("keeps OllamaLlm with the configured model and baseUrl when the probe succeeds", async () => {
    _resetAgentDepsForTests();
    const probe = async () => true;
    const d = await getAgentDepsAsync({ config: ollamaConfig(), probe });
    expect(d.llm).toBeInstanceOf(OllamaLlm);
    expect(d.llm).toMatchObject({ provider: "ollama", model: "qwen3:8b" });
    expect(d.config.llm).toMatchObject({ ollamaBaseUrl: "http://127.0.0.1:11434", ollamaModel: "qwen3:8b" });
    _resetAgentDepsForTests();
  });

  it("skips the probe entirely when a keyed provider is wired", async () => {
    _resetAgentDepsForTests();
    let probed = 0;
    const probe = async () => {
      probed += 1;
      return true;
    };
    const d = await getAgentDepsAsync({
      config: loadConfig({ NODE_ENV: "test", GROQ_API_KEY: "groq-key-123456" }),
      probe,
    });
    expect(probed).toBe(0);
    expect(d.llm).toBeInstanceOf(AiSdkLlm);
    expect(d.llm).toMatchObject({ provider: "groq" });
    _resetAgentDepsForTests();
  });
});
