/**
 * FROZEN CONTRACT (Phase 0). Taste-graph port, modelled on Qloo's real API
 * (docs/qloo-api.md). Adapters: src/lib/adapters/qloo/{http,mock}.ts (W-CORE).
 *
 * The port speaks Rekindle-friendly DTOs; adapters own the raw JSON mapping
 * (results[] vs results.entities[], entity_id, subtype, properties.image.url,
 * query.affinity, ...). Unknown/extra fields are dropped by the adapter.
 */
import type { QlooEntityType, QlooInsightsType } from "@/lib/domain/types";
import type { CallContext, ProviderMode } from "@/lib/ports/common";

/** An entity as returned by /search, /entities or /v2/insights. */
export interface TasteEntity {
  /** results[].entity_id */
  qlooId: string;
  name: string;
  /** results[].subtype (insights) or types[] (search). */
  type: QlooEntityType;
  /** properties.release_year (movie/tv) or publication_year (book), when present. */
  releaseYear?: number;
  /** properties.date_of_birth (person/artist), YYYY-MM-DD, when present. */
  dateOfBirth?: string;
  /** properties.image.url */
  imageUrl?: string;
  /** properties.short_description / description (English preferred). */
  description?: string;
  /** e.g. "2022, Daniel Scheinert, Daniel Kwan". Useful for disambiguation. */
  disambiguation?: string;
  /** popularity percentile 0-1 */
  popularity?: number;
  /** query.affinity 0-1, only for insights calls that had a signal. */
  affinity?: number;
  tags: TasteTag[];
}

export interface TasteTag {
  /** e.g. "urn:tag:genre:music:60s" */
  id: string;
  name: string;
  /** e.g. "urn:tag:genre:music" */
  type?: string;
}

/** GET /search */
export interface TasteSearchQuery {
  query: string;
  /** Sent as `types` (comma list). */
  types: QlooEntityType[];
  /** Default from config (QLOO_DEFAULT_TAKE). */
  take?: number;
}

/** Qloo `signal.demographics.age` buckets. Rekindle's people are almost always "55_and_older". */
export type QlooAgeBucket = "24_and_younger" | "25_to_29" | "30_to_34" | "35_to_44" | "45_to_54" | "55_and_older";

export type QlooTrendBias = "off" | "very_low" | "low" | "medium" | "high" | "very_high";

/**
 * Era filters. Qloo supports a different one per type (see ERA_FILTER_SUPPORT);
 * the adapter sends only the filters valid for `type` and ignores the others,
 * because Qloo silently ignores unsupported params.
 */
export interface TasteEraFilter {
  /** filter.release_year.min/max: movie, tv_show */
  releaseYear?: { min?: number; max?: number };
  /** filter.publication_year.min/max: book */
  publicationYear?: { min?: number; max?: number };
  /** filter.date_of_birth.min/max (YYYY-MM-DD): person */
  dateOfBirth?: { min?: string; max?: string };
}

/** GET /v2/insights */
export interface TasteInsightsQuery {
  /** filter.type */
  type: QlooInsightsType;
  /** signal.interests.entities (Qloo ids of verified seeds). */
  seedEntityIds?: string[];
  /** signal.interests.tags */
  seedTagIds?: string[];
  /** signal.location.query (fuzzy locality name, e.g. "Naples"). 400 if unknown: adapter retries without it. */
  locationQuery?: string;
  /** signal.demographics.age */
  ageBucket?: QlooAgeBucket;
  era?: TasteEraFilter;
  /** filter.tags (e.g. "urn:tag:genre:music:60s" for artists, which have no year filter). */
  filterTagIds?: string[];
  /** filter.exclude.entities */
  excludeEntityIds?: string[];
  /** filter.popularity.min (0-1) */
  minPopularity?: number;
  /** bias.trends. Default "off": nostalgia, not what is trending now. */
  trendBias?: QlooTrendBias;
  /** filter.exists=properties.image */
  requireImage?: boolean;
  /** take (max 50). */
  take?: number;
}

/** GET /v2/tags */
export interface TasteTagSearchQuery {
  /** filter.query */
  query: string;
  /** filter.tag.types, e.g. ["urn:tag:genre:music"] */
  tagTypes?: string[];
  take?: number;
}

export interface TastePort {
  readonly mode: ProviderMode;
  /** Find entities by name within types. Ordered by Qloo match score. */
  search(query: TasteSearchQuery, ctx: CallContext): Promise<TasteEntity[]>;
  /** GET /entities?entity_ids=... Batch lookup by Qloo id. Missing ids are omitted. */
  getEntities(qlooIds: string[], ctx: CallContext): Promise<TasteEntity[]>;
  /** Cross-domain affinity recommendations. Ordered by affinity. */
  insights(query: TasteInsightsQuery, ctx: CallContext): Promise<TasteEntity[]>;
  /** Tag lookup (decade/genre tags used as filters for types without a year filter). */
  searchTags(query: TasteTagSearchQuery, ctx: CallContext): Promise<TasteTag[]>;
}

/** Which era filter each insights type supports (docs/qloo-api.md section 3.3). */
export const ERA_FILTER_SUPPORT: Record<QlooInsightsType, keyof TasteEraFilter | "tags-only"> = {
  "urn:entity:movie": "releaseYear",
  "urn:entity:tv_show": "releaseYear",
  "urn:entity:book": "publicationYear",
  "urn:entity:person": "dateOfBirth",
  "urn:entity:artist": "tags-only",
  "urn:entity:brand": "tags-only",
  "urn:entity:place": "tags-only",
  "urn:entity:destination": "tags-only",
  "urn:entity:podcast": "tags-only",
  "urn:entity:videogame": "tags-only",
};
