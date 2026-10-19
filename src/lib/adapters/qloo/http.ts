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
import { abortableSleep, BACKOFF_MAX_MS, backoffMs } from "@/lib/adapters/shared/backoff";
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
export const QLOO_MAX_RETRY_WAIT_MS = BACKOFF_MAX_MS;

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

    const first = await parseJson(response);
    let items = extract(first);
    if (!items) throw new PortError("taste", "invalid_response", "Qloo returned an unexpected response shape", false);

    // Empty-result fallback for /v2/insights when the request combined a location
    // signal and a tag filter: that pair is often too narrow on the hackathon tier.
    // Probe showed e.g. Naples + 50s rock'n'roll returning 0. Attempt 2 drops the
    // location (keeps tags); if still empty, attempt 3 drops tags (keeps the
    // original location). Nothing personal ever reaches Qloo; the drops are logged
    // with the dropped param name only.
    if (
      items.length === 0 &&
      endpoint === "/v2/insights" &&
      "signal.location.query" in sent &&
      "filter.tags" in sent
    ) {
      log.info({ droppedParam: "signal.location.query" }, "qloo insights returned 0; retrying without location signal");
      const attempt2Params = withoutParam(sent, "signal.location.query");
      const attempt2 = await this.fetchWithRetry(endpoint, attempt2Params, ctx);
      if (!attempt2.ok) {
        // R5: a 5xx that still slipped through the retry budget would otherwise be
        // silently swallowed. Keep best-effort semantics (do not throw) but log one
        // line so an operator can see which drop was attempted.
        log.info({ droppedParam: "signal.location.query", status: attempt2.status }, "qloo insights retry (attempt 2) failed; keeping original empty result");
      } else {
        const attempt2Items = extract(await parseJson(attempt2));
        if (attempt2Items && attempt2Items.length > 0) {
          sent = attempt2Params;
          items = attempt2Items;
        } else {
          log.info({ droppedParam: "filter.tags" }, "qloo insights still 0; retrying without tag filter");
          const attempt3Params = withoutParam(params, "filter.tags");
          const attempt3 = await this.fetchWithRetry(endpoint, attempt3Params, ctx);
          if (!attempt3.ok) {
            log.info({ droppedParam: "filter.tags", status: attempt3.status }, "qloo insights retry (attempt 3) failed; keeping original empty result");
          } else {
            const attempt3Items = extract(await parseJson(attempt3));
            // R3: only replace items/sent when the attempt actually produced results.
            // Mirror attempt 2's semantics so the cache does not store an empty page
            // under attempt-3 params and shadow a later request that could succeed.
            if (attempt3Items && attempt3Items.length > 0) {
              sent = attempt3Params;
              items = attempt3Items;
            }
          }
        }
      }
    }

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
          await sleep(backoffMs(attempt), ctx.signal);
          continue;
        }
        throw timedOut
          ? new PortError("taste", "timeout", "Qloo took too long to answer", true, { cause: error })
          : new PortError("taste", "unavailable", "Qloo could not be reached", true, { cause: error });
      }
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt >= attempts) return response;
      ctx.logger.warn({ port: "taste", endpoint, status: response.status, attempt }, "qloo call retry");
      await sleep(retryAfterMs(response.headers.get("retry-after")) ?? backoffMs(attempt), ctx.signal);
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


async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    throw new PortError("taste", "invalid_response", "Qloo returned an unreadable response", false, { cause: error });
  }
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
