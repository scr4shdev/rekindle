import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RedisLike } from "@/lib/adapters/cache";
import { LayeredCache, MemoryCache, NoopCache, UpstashCache } from "@/lib/adapters/cache";

import { recordingLogger, silentLogger } from "./helpers";

describe("MemoryCache", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("returns stored values until the TTL expires", async () => {
    const cache = new MemoryCache();
    await cache.set("k", { a: 1 }, { ttlSeconds: 10 });
    expect(await cache.get("k")).toEqual({ a: 1 });
    vi.advanceTimersByTime(9_999);
    expect(await cache.get("k")).toEqual({ a: 1 });
    vi.advanceTimersByTime(1);
    expect(await cache.get("k")).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("evicts the least recently used entry beyond maxEntries", async () => {
    const cache = new MemoryCache({ maxEntries: 2 });
    await cache.set("a", 1, { ttlSeconds: 60 });
    await cache.set("b", 2, { ttlSeconds: 60 });
    expect(await cache.get("a")).toBe(1); // a is now most recent
    await cache.set("c", 3, { ttlSeconds: 60 });
    expect(await cache.get("b")).toBeUndefined();
    expect(await cache.get("a")).toBe(1);
    expect(await cache.get("c")).toBe(3);
  });

  it("does not store with a zero TTL, and keeps sensitive values in memory", async () => {
    const cache = new MemoryCache();
    await cache.set("z", 1, { ttlSeconds: 0 });
    expect(await cache.get("z")).toBeUndefined();
    await cache.set("s", "derived", { ttlSeconds: 5, sensitive: true });
    expect(await cache.get("s")).toBe("derived");
  });

  it("NoopCache never stores", async () => {
    const cache = new NoopCache();
    await cache.set("k", 1, { ttlSeconds: 60 });
    expect(await cache.get("k")).toBeUndefined();
  });
});

class FakeRedis implements RedisLike {
  store = new Map<string, string>();
  sets: Array<{ key: string; ex: number }> = [];
  failing = false;
  async get(key: string) {
    if (this.failing) throw new Error("boom with secret-ish details");
    return this.store.get(key) ?? null;
  }
  async set(key: string, value: string, options: { ex: number }) {
    if (this.failing) throw new Error("boom");
    this.sets.push({ key, ex: options.ex });
    this.store.set(key, value);
    return "OK";
  }
}

describe("UpstashCache", () => {
  it("round-trips JSON with a TTL", async () => {
    const redis = new FakeRedis();
    const cache = new UpstashCache(redis, silentLogger);
    await cache.set("k", { nested: [1, "two"] }, { ttlSeconds: 30 });
    expect(redis.sets).toEqual([{ key: "k", ex: 30 }]);
    expect(typeof redis.store.get("k")).toBe("string");
    expect(await cache.get("k")).toEqual({ nested: [1, "two"] });
    expect(await cache.get("missing")).toBeUndefined();
  });

  it("never sends sensitive values", async () => {
    const redis = new FakeRedis();
    const cache = new UpstashCache(redis, silentLogger);
    await cache.set("k", "from notes", { ttlSeconds: 30, sensitive: true });
    expect(redis.sets).toHaveLength(0);
  });

  it("degrades errors to a miss plus a warn log without the error message", async () => {
    const redis = new FakeRedis();
    redis.failing = true;
    const { logger, lines } = recordingLogger();
    const cache = new UpstashCache(redis, logger);
    await expect(cache.get("k")).resolves.toBeUndefined();
    await expect(cache.set("k", 1, { ttlSeconds: 5 })).resolves.toBeUndefined();
    expect(lines).toHaveLength(2);
    expect(lines.join("")).toContain('"level":40');
    expect(lines.join("")).not.toContain("secret-ish");
  });
});

describe("LayeredCache", () => {
  it("reads memory first, then remote, and backfills memory", async () => {
    const memory = new MemoryCache();
    const redis = new FakeRedis();
    const remote = new UpstashCache(redis, silentLogger);
    const cache = new LayeredCache(memory, remote);
    redis.store.set("r", JSON.stringify({ v: 1 }));
    expect(await cache.get("r")).toEqual({ v: 1 });
    redis.store.clear();
    expect(await cache.get("r")).toEqual({ v: 1 });
  });

  it("writes sensitive values to memory only", async () => {
    const memory = new MemoryCache();
    const redis = new FakeRedis();
    const cache = new LayeredCache(memory, new UpstashCache(redis, silentLogger));
    await cache.set("s", "anchors", { ttlSeconds: 60, sensitive: true });
    await cache.set("p", "public", { ttlSeconds: 60 });
    expect([...redis.store.keys()]).toEqual(["p"]);
    expect(await memory.get("s")).toBe("anchors");
    expect(cache.driver).toBe("layered");
  });
});
