/**
 * Live Qloo adapter: documented GET endpoints on the hackathon host with
 * `X-Api-Key` (docs/qloo-api.md). Serverless-safe (plain fetch), bounded
 * retries on 429/5xx honouring Retry-After, per-call timeout, input-keyed
 * cache. The key never appears in records, logs or error messages.
 */
import type { z } from "zod";

import type { AppConfig } from "@/lib/config";
import type { QlooCallRecord } from "@/lib/domain/types";
import type { CachePort } from "@/lib/ports/cache";
import { buildCacheKey } from "@/lib/ports/cache";
import type { CallContext } from "@/lib/ports/common";
import { PortError } from "@/lib/ports/common";
import type { TasteEntity, TastePort, TasteResponse, TasteTag } from "@/lib/ports/taste";
import { TasteInsightsQuery, TasteLookupQuery, TasteSearchQuery, TasteTagSearchQuery } from "@/lib/ports/taste";

import { extractEntities, extractTags } from "@/lib/adapters/qloo/mapping";
import type { QlooEndpoint, QlooParams } from "@/lib/adapters/qloo/params";
import {
  insightsParams,
  lookupParams,
  searchParams,
  tagSearchParams,
  toUrlSearchParams,
  withoutParam,
} from "@/lib/adapters/qloo/params";

/** Adapter/API version in the cache key. Bump when the mapping or params change. */
export const QLOO_CACHE_VERSION = "qloo-v2";
/** Longest Retry-After we are willing to wait inside a serverless request. */
export const QLOO_MAX_RETRY_WAIT_MS = 4_000;
const BACKOFF_BASE_MS = 300;

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

interface CachedPage<T> {
  items: T[];
  params: QlooParams;
}

export class QlooHttp implements TastePort {
  readonly mode = "live" as const;

  constructor(
    private readonly config: AppConfig["qloo"],
    private readonly cache: CachePort,
    private readonly options: { fetch?: FetchLike; keyPrefix?: string; sleep?: (ms: number, signal?: AbortSignal) => Promise<void> } = {},
  ) {}

  async search(query: TasteSearchQuery, ctx: CallContext): Promise<TasteResponse<TasteEntity>> {
    const q = parseQuery(TasteSearchQuery, query);
    return this.call("/search", q, searchParams(q, this.config.defaultTake), extractEntities, ctx);
  }

  async getEntities(query: TasteLookupQuery, ctx: CallContext): Promise<TasteResponse<TasteEntity>> {
    const q = parseQuery(TasteLookupQuery, query);
    return this.call("/entities", q, lookupParams(q), extractEntities, ctx);
  }

  async insights(query: TasteInsightsQuery, ctx: CallContext): Promise<TasteResponse<TasteEntity>> {
    const q = parseQuery(TasteInsightsQuery, query);
    return this.call("/v2/insights", q, insightsParams(q, this.config.defaultTake), extractEntities, ctx);
  }

  async searchTags(query: TasteTagSearchQuery, ctx: CallContext): Promise<TasteResponse<TasteTag>> {
    const q = parseQuery(TasteTagSearchQuery, query);
    return this.call("/v2/tags", q, tagSearchParams(q, this.config.defaultTake), extractTags, ctx);
  }

  private async call<T>(
    endpoint: QlooEndpoint,
    query: unknown,
    params: QlooParams,
    extract: (json: unknown) => T[] | undefined,
    ctx: CallContext,
  ): Promise<TasteResponse<T>> {
    const started = Date.now();
    const log = ctx.logger.child({ port: "taste", endpoint });
    const key = buildCacheKey(
      { provider: "qloo", model: endpoint, promptVersion: QLOO_CACHE_VERSION, input: query },
      this.options.keyPrefix,
    );
    const hit = await this.cache.get<CachedPage<T>>(key);
    if (hit) {
      const record = this.record(endpoint, hit.params, hit.items.length, Date.now() - started, true);
      log.info({ cached: true, resultCount: hit.items.length }, "qloo call");
      return { items: hit.items, request: record };
    }

    let sent = params;
    let response = await this.fetchWithRetry(endpoint, sent, ctx);
    // An unknown `signal.location.query` returns 400: retry once without it.
    if (response.status === 400 && "signal.location.query" in sent) {
      log.info({ status: 400 }, "qloo location not recognised; retrying without it");
      sent = withoutParam(sent, "signal.location.query");
      response = await this.fetchWithRetry(endpoint, sent, ctx);
    }
    if (!response.ok) throw statusError(response.status);

    let json: unknown;
    try {
      json = await response.json();
    } catch (error) {
      throw new PortError("taste", "invalid_response", "Qloo returned an unreadable response", false, { cause: error });
    }
    const items = extract(json);
    if (!items) throw new PortError("taste", "invalid_response", "Qloo returned an unexpected response shape", false);

    await this.cache.set<CachedPage<T>>(key, { items, params: sent }, { ttlSeconds: this.config.cacheTtlSeconds });
    const durationMs = Date.now() - started;
    log.info({ cached: false, status: response.status, resultCount: items.length, durationMs }, "qloo call");
    return { items, request: this.record(endpoint, sent, items.length, durationMs, false) };
  }

  private record(endpoint: QlooEndpoint, params: QlooParams, resultCount: number, durationMs: number, cached: boolean): QlooCallRecord {
    return { endpoint, params, resultCount, durationMs, cached, source: "live" };
  }

  private async fetchWithRetry(endpoint: QlooEndpoint, params: QlooParams, ctx: CallContext): Promise<Response> {
    const doFetch = this.options.fetch ?? ((input, init) => fetch(input, init));
    const sleep = this.options.sleep ?? abortableSleep;
    const url = `${this.config.baseUrl}${endpoint}?${toUrlSearchParams(params).toString()}`;
    const attempts = this.config.maxRetries + 1;

    for (let attempt = 1; ; attempt++) {
      if (ctx.signal?.aborted) throw new PortError("taste", "timeout", "The Qloo request was cancelled", false);
      const timeout = AbortSignal.timeout(this.config.timeoutMs);
      const signal = ctx.signal ? AbortSignal.any([ctx.signal, timeout]) : timeout;
      let response: Response;
      try {
        response = await doFetch(url, {
          method: "GET",
          headers: { "X-Api-Key": this.config.apiKey ?? "", Accept: "application/json" },
          signal,
        });
      } catch (error) {
        const timedOut = timeout.aborted && !ctx.signal?.aborted;
        if (ctx.signal?.aborted) throw new PortError("taste", "timeout", "The Qloo request was cancelled", false, { cause: error });
        if (attempt < attempts) {
          await sleep(backoff(attempt), ctx.signal);
          continue;
        }
        throw timedOut
          ? new PortError("taste", "timeout", "Qloo took too long to answer", true, { cause: error })
          : new PortError("taste", "unavailable", "Qloo could not be reached", true, { cause: error });
      }
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt >= attempts) return response;
      ctx.logger.warn({ port: "taste", endpoint, status: response.status, attempt }, "qloo call retry");
      await sleep(retryAfterMs(response.headers.get("retry-after")) ?? backoff(attempt), ctx.signal);
    }
  }
}

/**
 * HARD RULE 2: every query is parsed with the strict port schema before it can
 * be sent (unknown keys, e.g. a person's name, are rejected).
 */
export function parseQuery<T>(schema: z.ZodType<T>, query: unknown): T {
  const parsed = schema.safeParse(query);
  if (!parsed.success) throw new PortError("taste", "bad_request", "Blocked a Qloo query with fields outside the allowed schema", false);
  return parsed.data;
}

function backoff(attempt: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** (attempt - 1), QLOO_MAX_RETRY_WAIT_MS);
}

/** Retry-After as seconds or an HTTP date, capped. */
export function retryAfterMs(header: string | null, now: number = Date.now()): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - now;
  if (!Number.isFinite(ms)) return undefined;
  return Math.min(Math.max(0, ms), QLOO_MAX_RETRY_WAIT_MS);
}

function statusError(status: number): PortError {
  if (status === 401 || status === 403) return new PortError("taste", "unauthorized", `Qloo refused the request (${status})`, false);
  if (status === 429) return new PortError("taste", "rate_limited", "Qloo is rate limiting requests", true);
  if (status === 400 || status === 404) return new PortError("taste", "bad_request", `Qloo rejected the request (${status})`, false);
  return new PortError("taste", "unavailable", `Qloo is unavailable (${status})`, true);
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0 || signal?.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });
}
