/**
 * Remote cache on Upstash Redis (REST, serverless-safe). Shared across
 * serverless instances, so it is used only for non-sensitive values:
 * `sensitive: true` entries (anything derived from caregiver notes) are never
 * sent. Errors degrade to a miss plus a warn log; this adapter never throws.
 */
import type { Logger } from "pino";

import type { CachePort, CacheSetOptions } from "@/lib/ports/cache";

/** The subset of the @upstash/redis client this adapter uses (fakeable in tests). */
export interface RedisLike {
  get(key: string): Promise<unknown>;
  set(key: string, value: string, options: { ex: number }): Promise<unknown>;
}

export class UpstashCache implements CachePort {
  readonly driver = "upstash" as const;

  constructor(
    private readonly client: RedisLike,
    private readonly logger: Logger,
  ) {}

  async get<T>(key: string): Promise<T | undefined> {
    try {
      const raw = await this.client.get(key);
      if (raw === null || raw === undefined) return undefined;
      // Values are stored as JSON strings; tolerate a client that already deserialized.
      return (typeof raw === "string" ? JSON.parse(raw) : raw) as T;
    } catch (error) {
      this.logger.warn({ op: "cache.get", driver: this.driver, err: errorName(error) }, "remote cache read failed");
      return undefined;
    }
  }

  async set<T>(key: string, value: T, options: CacheSetOptions): Promise<void> {
    if (options.sensitive || options.ttlSeconds <= 0) return;
    try {
      await this.client.set(key, JSON.stringify(value), { ex: Math.ceil(options.ttlSeconds) });
    } catch (error) {
      this.logger.warn({ op: "cache.set", driver: this.driver, err: errorName(error) }, "remote cache write failed");
    }
  }
}

/** Error class name only: messages from remote clients may echo request data. */
function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
