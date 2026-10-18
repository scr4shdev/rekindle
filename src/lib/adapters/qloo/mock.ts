/**
 * Mock Qloo for demo and tests: same port, same strict query parsing and the
 * same params builders as QlooHttp, served from the hand-authored catalog.
 * Deterministic: equal queries always give equal results in equal order.
 */
import type { QlooCallRecord } from "@/lib/domain/types";
import type { CallContext } from "@/lib/ports/common";
import type { TasteEntity, TastePort, TasteResponse, TasteTag } from "@/lib/ports/taste";
import {
  ERA_FILTER_SUPPORT,
  TasteInsightsQuery,
  TasteLookupQuery,
  TasteSearchQuery,
  TasteTagSearchQuery,
} from "@/lib/ports/taste";

import type { MockEntity, MockGroup } from "@/lib/adapters/qloo/fixtures/catalog";
import { MOCK_CATALOG, MOCK_TAGS } from "@/lib/adapters/qloo/fixtures/catalog";
import { parseQuery } from "@/lib/adapters/qloo/http";
import type { QlooEndpoint, QlooParams } from "@/lib/adapters/qloo/params";
import { insightsParams, lookupParams, searchParams, tagSearchParams } from "@/lib/adapters/qloo/params";

/** Name normalization for exact matching: Unicode-folded, accent-free, lower case, single spaces. */
export function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[‘’ʼ]/g, "'")
    .toLowerCase()
    .trim()
    .split(/\s+/u)
    .join(" ");
}

const compact = (name: string) => normalizeName(name).replace(/[^\p{L}\p{N}]/gu, "");

function tagsOf(entity: MockEntity): TasteTag[] {
  return (entity.tags ?? [])
    .map((name) => MOCK_TAGS.find((t) => t.name === name))
    .filter((t) => t !== undefined)
    .map((t) => ({ id: t.id, name: t.name, type: t.type }));
}

function toTasteEntity(entity: MockEntity, withAffinity: boolean): TasteEntity {
  const out: TasteEntity = { qlooId: entity.qlooId, name: entity.name, type: entity.type, popularity: entity.popularity, tags: tagsOf(entity) };
  if (entity.releaseYear !== undefined) out.releaseYear = entity.releaseYear;
  if (entity.dateOfBirth) out.dateOfBirth = entity.dateOfBirth;
  if (entity.description) out.description = entity.description;
  if (entity.disambiguation) out.disambiguation = entity.disambiguation;
  if (withAffinity) out.affinity = entity.affinity;
  return out;
}

const inRange = (value: number | string | undefined, min?: number | string, max?: number | string) =>
  value !== undefined && (min === undefined || value >= min) && (max === undefined || value <= max);

export class MockQloo implements TastePort {
  readonly mode = "mock" as const;

  constructor(
    private readonly options: { defaultTake: number; latencyMs?: number; catalog?: readonly MockEntity[] } = { defaultTake: 10 },
  ) {}

  private get catalog() {
    return this.options.catalog ?? MOCK_CATALOG;
  }

  async search(query: TasteSearchQuery, ctx: CallContext): Promise<TasteResponse<TasteEntity>> {
    const q = parseQuery(TasteSearchQuery, query);
    const params = searchParams(q, this.options.defaultTake);
    const wanted = normalizeName(q.query);
    const wantedCompact = compact(q.query);
    const ofType = this.catalog.filter((e) => q.types.includes(e.type));
    const exact = ofType.filter((e) => normalizeName(e.name) === wanted);
    const fuzzy = ofType.filter((e) => {
      if (exact.includes(e)) return false;
      const c = compact(e.name);
      return c === wantedCompact || (Math.min(c.length, wantedCompact.length) >= 4 && (c.includes(wantedCompact) || wantedCompact.includes(c)));
    });
    const byPopularity = (a: MockEntity, b: MockEntity) => b.popularity - a.popularity || a.name.localeCompare(b.name);
    const items = [...exact.sort(byPopularity), ...fuzzy.sort(byPopularity)]
      .slice(0, Number(params.take))
      .map((e) => toTasteEntity(e, false));
    return this.respond("/search", params, items, ctx);
  }

  async getEntities(query: TasteLookupQuery, ctx: CallContext): Promise<TasteResponse<TasteEntity>> {
    const q = parseQuery(TasteLookupQuery, query);
    const items = q.qlooIds
      .map((id) => this.catalog.find((e) => e.qlooId === id))
      .filter((e) => e !== undefined)
      .map((e) => toTasteEntity(e, false));
    return this.respond("/entities", lookupParams(q), items, ctx);
  }

  async insights(query: TasteInsightsQuery, ctx: CallContext): Promise<TasteResponse<TasteEntity>> {
    const q = parseQuery(TasteInsightsQuery, query);
    const params = insightsParams(q, this.options.defaultTake);
    const seeds = new Set(q.seedEntityIds ?? []);
    const groups = new Set<MockGroup>(this.catalog.filter((e) => seeds.has(e.qlooId)).map((e) => e.group));
    if (groups.size === 0) groups.add("generic");
    const excluded = new Set([...(q.excludeEntityIds ?? []), ...seeds]);
    const support = ERA_FILTER_SUPPORT[q.type];
    const era = q.era;
    const tagFilter = q.filterTagIds ?? [];

    const items = this.catalog
      .filter((e) => e.type === q.type && groups.has(e.group) && !excluded.has(e.qlooId))
      .filter((e) => q.minPopularity === undefined || e.popularity >= q.minPopularity)
      .filter((e) => tagFilter.length === 0 || tagsOf(e).some((t) => tagFilter.includes(t.id)))
      .filter((e) => {
        if (support === "releaseYear" && era?.releaseYear) return inRange(e.releaseYear, era.releaseYear.min, era.releaseYear.max);
        if (support === "publicationYear" && era?.publicationYear) return inRange(e.releaseYear, era.publicationYear.min, era.publicationYear.max);
        if (support === "dateOfBirth" && era?.dateOfBirth) return inRange(e.dateOfBirth, era.dateOfBirth.min, era.dateOfBirth.max);
        return true;
      })
      .sort((a, b) => b.affinity - a.affinity || a.name.localeCompare(b.name))
      .slice(0, Number(params.take))
      .map((e) => toTasteEntity(e, seeds.size > 0 || (q.seedTagIds?.length ?? 0) > 0));
    return this.respond("/v2/insights", params, items, ctx);
  }

  async searchTags(query: TasteTagSearchQuery, ctx: CallContext): Promise<TasteResponse<TasteTag>> {
    const q = parseQuery(TasteTagSearchQuery, query);
    const params = tagSearchParams(q, this.options.defaultTake);
    const wanted = normalizeName(q.query);
    const items = MOCK_TAGS.filter((t) => normalizeName(t.name) === wanted || t.id.endsWith(`:${wanted}`))
      .filter((t) => !q.tagTypes?.length || q.tagTypes.includes(t.type))
      .slice(0, Number(params.take))
      .map((t) => ({ id: t.id, name: t.name, type: t.type }));
    return this.respond("/v2/tags", params, items, ctx);
  }

  private async respond<T>(endpoint: QlooEndpoint, params: QlooParams, items: T[], ctx: CallContext): Promise<TasteResponse<T>> {
    const latency = this.options.latencyMs ?? 0;
    if (latency > 0) await sleep(latency, ctx.signal);
    const request: QlooCallRecord = { endpoint, params, resultCount: items.length, durationMs: latency, cached: false, source: "mock" };
    ctx.logger.debug({ port: "taste", endpoint, resultCount: items.length, source: "mock" }, "qloo call");
    return { items, request };
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });
}
