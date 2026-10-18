/**
 * FROZEN CONTRACT (Phase 0). LLM port: schema-validated structured output only.
 *
 * Every semantic decision (parsing notes, classifying, safety, era inference)
 * goes through `generateObject` with a zod schema. No free-text parsing, no regex.
 * Adapters: src/lib/adapters/llm/{ai-sdk,mock}.ts (W-CORE).
 */
import type { z } from "zod";

import type { CallContext, ProviderMode } from "@/lib/ports/common";

/**
 * A versioned prompt module (src/lib/prompts/*.ts). Bump `version` whenever
 * system/render/schema change: it is part of the cache key.
 */
export interface PromptDefinition<I, O> {
  /** Stable id, e.g. "parse-anchors". */
  id: string;
  /** Semver-ish, e.g. "1.0.0". Exported as VERSION by the prompt module. */
  version: string;
  system: string;
  /** Pure function: structured input -> user prompt text. */
  render: (input: I) => string;
  /** Output schema. Keep it provider-friendly (objects, arrays, enums, strings, numbers). */
  schema: z.ZodType<O>;
}

export interface LlmRequest<T> {
  promptId: string;
  version: string;
  system: string;
  /** Rendered user prompt. */
  prompt: string;
  /** Structured input the prompt was rendered from. Used (hashed) for the cache key and by the mock adapter. */
  input: unknown;
  schema: z.ZodType<T>;
  /**
   * true when input derives from caregiver notes (e.g. PARSE). The result may
   * only be cached in process memory, never in a remote cache.
   */
  sensitive?: boolean;
}

export interface LlmResult<T> {
  object: T;
  cached: boolean;
  provider: string;
  model: string;
  latencyMs: number;
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface LlmPort {
  readonly mode: ProviderMode;
  readonly provider: string;
  readonly model: string;
  /**
   * Generate an object matching `schema` at temperature 0 with the configured
   * pinned model. Throws PortError("llm", ...) on failure or schema mismatch
   * after retries.
   */
  generateObject<T>(request: LlmRequest<T>, ctx: CallContext): Promise<LlmResult<T>>;
}

/** Helper to turn a PromptDefinition + input into an LlmRequest. */
export function buildLlmRequest<I, O>(
  prompt: PromptDefinition<I, O>,
  input: I,
  options: { sensitive?: boolean } = {},
): LlmRequest<O> {
  return {
    promptId: prompt.id,
    version: prompt.version,
    system: prompt.system,
    prompt: prompt.render(input),
    input,
    schema: prompt.schema,
    sensitive: options.sensitive,
  };
}
