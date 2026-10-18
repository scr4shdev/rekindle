/**
 * FROZEN CONTRACT (Phase 0). Cache port + deterministic cache key.
 *
 * Keys are sha256 of provider + model + promptVersion + normalized input, so
 * no plaintext ever appears in a key. Adapters: src/lib/adapters/cache/
 * {memory,upstash,layered}.ts (W-CORE).
 */
import { createHash } from "node:crypto";

export interface CacheSetOptions {
  ttlSeconds: number;
  /**
   * Value derives from caregiver notes (e.g. PARSE anchors). Remote adapters
   * MUST NOT persist it; memory adapters may.
   */
  sensitive?: boolean;
}

export interface CachePort {
  readonly driver: "memory" | "upstash" | "layered" | "noop";
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, options: CacheSetOptions): Promise<void>;
}

export interface CacheKeyParts {
  /** e.g. "qloo", "gemini", "mock". */
  provider: string;
  /** Model id, or endpoint name for Qloo (e.g. "search", "insights"). */
  model: string;
  /** Prompt version for LLM calls; adapter/API version for Qloo calls. */
  promptVersion: string;
  input: unknown;
}

/** Recursively normalize: sort object keys, NFC + trim + collapse whitespace in strings, drop undefined. */
export function normalizeForKey(value: unknown): unknown {
  if (typeof value === "string") return value.normalize("NFC").trim().split(/\s+/u).join(" ");
  if (Array.isArray(value)) return value.map(normalizeForKey);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = normalizeForKey(v);
    }
    return out;
  }
  return value;
}

/** Deterministic cache key: `<prefix>:<provider>:<sha256 hex>`. */
export function buildCacheKey(parts: CacheKeyParts, prefix = "rekindle:v1"): string {
  const canonical = JSON.stringify(
    normalizeForKey({ provider: parts.provider, model: parts.model, v: parts.promptVersion, input: parts.input }),
  );
  const digest = createHash("sha256").update(canonical).digest("hex");
  return `${prefix}:${parts.provider}:${digest}`;
}
