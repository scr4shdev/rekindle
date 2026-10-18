import { describe, expect, it } from "vitest";

import { buildCacheKey } from "@/lib/ports/cache";

describe("cache key", () => {
  it("is deterministic, order-insensitive for object keys, and never contains plaintext", () => {
    const a = buildCacheKey({ provider: "gemini", model: "m", promptVersion: "1.0.0", input: { b: 1, a: " Naples  1942 " } });
    const b = buildCacheKey({ provider: "gemini", model: "m", promptVersion: "1.0.0", input: { a: "Naples 1942", b: 1 } });
    const c = buildCacheKey({ provider: "gemini", model: "m", promptVersion: "1.0.1", input: { a: "Naples 1942", b: 1 } });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toContain("Naples");
    expect(a).toMatch(/^rekindle:v1:gemini:[0-9a-f]{64}$/);
  });
});
