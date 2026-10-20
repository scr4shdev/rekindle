/**
 * FROZEN CONTRACT (Phase 0). Barrel for all ports, plus the dependency bundle
 * the agent loop receives from src/lib/composition.ts.
 */
import type { AppConfig } from "@/lib/config";
import type { CachePort } from "@/lib/ports/cache";
import type { LlmPort } from "@/lib/ports/llm";
import type { TastePort } from "@/lib/ports/taste";
import type { TtsPort } from "@/lib/ports/tts";

export * from "@/lib/ports/cache";
export * from "@/lib/ports/common";
export * from "@/lib/ports/llm";
export * from "@/lib/ports/taste";
export * from "@/lib/ports/tts";

/** Everything the agent needs. Built once per serverless instance by composition.ts. */
export interface AgentDeps {
  taste: TastePort;
  llm: LlmPort;
  cache: CachePort;
  /** Optional: present only when a hosted TTS key is wired (demo-only path). */
  tts?: TtsPort;
  config: AppConfig;
  /** Injected clock for deterministic tests. */
  now: () => Date;
  /** Injected id generator for deterministic tests. */
  newId: (prefix: string) => string;
}
