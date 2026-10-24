/**
 * Query builders shared by the HTTP and mock Qloo adapters: port query DTO
 * (already parsed with the strict port schemas) -> Qloo query params, exactly
 * as documented in docs/qloo-api.md. Arrays stay arrays in the record (that is
 * what the trace shows) and are comma-joined only when the URL is built.
 */
import type { QlooCallRecord } from "@/lib/domain/types";
import type { TasteInsightsQuery, TasteLookupQuery, TasteSearchQuery, TasteTagSearchQuery } from "@/lib/ports/taste";
import { ERA_FILTER_SUPPORT } from "@/lib/ports/taste";

export type QlooParams = QlooCallRecord["params"];
export type QlooEndpoint = QlooCallRecord["endpoint"];

/** Qloo caps `take` at 50 for insights and tags (docs/qloo-api.md 3.4). */
export const QLOO_MAX_TAKE = 50;

const clampTake = (take: number | undefined, defaultTake: number) => Math.min(take ?? defaultTake, QLOO_MAX_TAKE);

function put(params: QlooParams, key: string, value: string | number | boolean | string[] | undefined): void {
  if (value === undefined) return;
  if (Array.isArray(value) && value.length === 0) return;
  params[key] = value;
}

export function searchParams(query: TasteSearchQuery, defaultTake: number): QlooParams {
  return { query: query.query, types: [...query.types], take: clampTake(query.take, defaultTake) };
}

export function lookupParams(query: TasteLookupQuery): QlooParams {
  return { entity_ids: [...query.qlooIds] };
}

export function tagSearchParams(query: TasteTagSearchQuery, defaultTake: number): QlooParams {
  const params: QlooParams = { "filter.query": query.query };
  put(params, "filter.tag.types", query.tagTypes);
  params.take = clampTake(query.take, defaultTake);
  return params;
}

export function insightsParams(query: TasteInsightsQuery, defaultTake: number): QlooParams {
  const params: QlooParams = { "filter.type": query.type };
  put(params, "signal.interests.entities", query.seedEntityIds);
  put(params, "signal.interests.tags", query.seedTagIds);
  // Several tags (e.g. 50s, 60s, 70s) mean "any of these", not Qloo's default intersection.
  if ((query.seedTagIds?.length ?? 0) > 1) params["operator.signal.interests.tags"] = "union";
  put(params, "signal.location.query", query.locationQuery);
  put(params, "signal.demographics.age", query.ageBucket);

  // Era filters: only the one this type supports. Qloo silently ignores the others.
  const support = ERA_FILTER_SUPPORT[query.type];
  const era = query.era;
  if (support === "releaseYear" && era?.releaseYear) {
    put(params, "filter.release_year.min", era.releaseYear.min);
    put(params, "filter.release_year.max", era.releaseYear.max);
  } else if (support === "publicationYear" && era?.publicationYear) {
    put(params, "filter.publication_year.min", era.publicationYear.min);
    put(params, "filter.publication_year.max", era.publicationYear.max);
  } else if (support === "dateOfBirth" && era?.dateOfBirth) {
    put(params, "filter.date_of_birth.min", era.dateOfBirth.min);
    put(params, "filter.date_of_birth.max", era.dateOfBirth.max);
  }

  put(params, "filter.tags", query.filterTagIds);
  put(params, "filter.exclude.entities", query.excludeEntityIds);
  put(params, "filter.popularity.min", query.minPopularity);
  // Nostalgia, not what is trending now.
  params["bias.trends"] = query.trendBias ?? "off";
  if (query.requireImage) params["filter.exists"] = "properties.image";
  // E1 (why-this-anchor): ask Qloo to attach per-result seed attribution so the
  // judge-facing chip can tell the "linked to X" story honestly. docs/qloo-api.md
  // section 3.4: unknown params are silently ignored, so a hackathon tier that
  // does not support the flag degrades to no attribution rather than failing.
  params["feature.explainability"] = true;
  params.take = clampTake(query.take, defaultTake);
  return params;
}

/** Build the URL query string: arrays comma-joined (OpenAPI `style: form, explode: false`). */
export function toUrlSearchParams(params: QlooParams): URLSearchParams {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    search.set(key, Array.isArray(value) ? value.join(",") : String(value));
  }
  return search;
}

/** Copy of params without one key (used to retry without an unknown `signal.location.query`). */
export function withoutParam(params: QlooParams, key: string): QlooParams {
  const copy = { ...params };
  delete copy[key];
  return copy;
}
