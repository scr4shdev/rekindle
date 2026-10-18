/**
 * In-process cache: TTL plus a bounded LRU. One instance per serverless
 * instance (warm invocations share it). Safe for `sensitive` values because
 * nothing leaves process memory.
 */
import type { CachePort, CacheSetOptions } from "@/lib/ports/cache";

/**
 * Upper bound on entries kept per process. Each entry is a small JSON value
 * (an LLM object or a mapped Qloo page), so this stays well under a few MB.
 */
export const MEMORY_CACHE_MAX_ENTRIES = 500;

interface Entry {
  value: unknown;
  expiresAt: number;
}

export class MemoryCache implements CachePort {
  readonly driver = "memory" as const;
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly options: { maxEntries?: number; now?: () => number } = {},
  ) {}

  private get now(): number {
    return (this.options.now ?? Date.now)();
  }

  private get maxEntries(): number {
    return this.options.maxEntries ?? MEMORY_CACHE_MAX_ENTRIES;
  }

  get size(): number {
    return this.entries.size;
  }

  async get<T>(key: string): Promise<T | undefined> {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now) {
      this.entries.delete(key);
      return undefined;
    }
    // Refresh recency: Map iteration order is insertion order.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value as T;
  }

  async set<T>(key: string, value: T, options: CacheSetOptions): Promise<void> {
    if (options.ttlSeconds <= 0) return;
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now + options.ttlSeconds * 1000 });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }
}

/** Cache that never stores anything (tests, or caching disabled). */
export class NoopCache implements CachePort {
  readonly driver = "noop" as const;
  async get<T>(key: string): Promise<T | undefined> {
    void key;
    return undefined;
  }
  async set<T>(key: string, value: T, options: CacheSetOptions): Promise<void> {
    void key;
    void value;
    void options;
  }
}
