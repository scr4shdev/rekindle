/**
 * Memory in front of a remote cache. Reads hit memory first, then the remote
 * (and backfill memory). Writes go to memory always and to the remote only for
 * non-sensitive values (the remote adapter enforces this too).
 */
import type { CachePort, CacheSetOptions } from "@/lib/ports/cache";

/** TTL for values copied from the remote into memory on a read (the remote keeps the authoritative TTL). */
export const LAYERED_BACKFILL_TTL_SECONDS = 600;

export class LayeredCache implements CachePort {
  readonly driver = "layered" as const;

  constructor(
    private readonly memory: CachePort,
    private readonly remote: CachePort,
  ) {}

  async get<T>(key: string): Promise<T | undefined> {
    const local = await this.memory.get<T>(key);
    if (local !== undefined) return local;
    const remote = await this.remote.get<T>(key);
    if (remote !== undefined) await this.memory.set(key, remote, { ttlSeconds: LAYERED_BACKFILL_TTL_SECONDS });
    return remote;
  }

  async set<T>(key: string, value: T, options: CacheSetOptions): Promise<void> {
    await this.memory.set(key, value, options);
    if (!options.sensitive) await this.remote.set(key, value, options);
  }
}
