/**
 * FROZEN CONTRACT (Phase 0). Taste-graph port, modelled on Qloo's real API
 * (docs/qloo-api.md). Adapters: src/lib/adapters/qloo/{http,mock}.ts (W-CORE).
 *
 * The port speaks Rekindle-friendly DTOs; adapters own the raw JSON mapping
 * (results[] vs results.entities[], entity_id, subtype, properties.image.url,
 * query.affinity, ...). Unknown/extra fields are dropped by the adapter.
 *
 * HARD RULE (Qloo safe-use): no personal data ever reaches Qloo. Queries carry
 * only cultural anchors (entity names, Qloo ids, tag ids, place names, years,
 * age bucket). The query schemas below are `.strict()`: they have no field for a
 * person's name, notes, email or device id, and adapters MUST parse every query
 * with them (unknown keys are rejected). `withPersonalDataGuard` additionally
 * blocks any outgoing string that equals or contains the person's display name.
 */
import { z } from "zod";

import { QlooEntityType, QlooInsightsType } from "@/lib/domain/types";
import type { QlooCallRecord } from "@/lib/domain/types";
import type { CallContext, ProviderMode } from "@/lib/ports/common";
import { PortError } from "@/lib/ports/common";

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

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
  /** query.affinity 0-1, only for insights calls that had a signal. Aggregate audience affinity, not a personal prediction. */
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

/**
 * Every port call returns its results plus a redacted record of the request
 * that produced them (request-to-result provenance, shown in the UI trace and
 * required by the Qloo submission guide).
 */
export interface TasteResponse<T> {
  items: T[];
  request: QlooCallRecord;
}

// ---------------------------------------------------------------------------
// Queries (strict: no field can carry personal data)
// ---------------------------------------------------------------------------

const CulturalText = z.string().trim().min(1).max(160);
const QlooId = z.string().trim().min(1).max(128);
const TagId = z.string().trim().startsWith("urn:tag:").max(200);
const YearRange = z.object({ min: z.number().int().optional(), max: z.number().int().optional() }).strict();
const DateRange = z.object({ min: z.iso.date().optional(), max: z.iso.date().optional() }).strict();

/** GET /search */
export const TasteSearchQuery = z
  .object({
    /** A public cultural entity name (e.g. "Renato Carosone"). Never a person's own name. */
    query: CulturalText,
    /** Sent as `types` (comma list). */
    types: z.array(QlooEntityType).min(1).max(5),
    /** Default from config (QLOO_DEFAULT_TAKE). */
    take: z.number().int().min(1).max(50).optional(),
  })
  .strict();
export type TasteSearchQuery = z.infer<typeof TasteSearchQuery>;

/** Qloo `signal.demographics.age` buckets. Rekindle's people are almost always "55_and_older". */
export const QlooAgeBucket = z.enum(["24_and_younger", "25_to_29", "30_to_34", "35_to_44", "45_to_54", "55_and_older"]);
export type QlooAgeBucket = z.infer<typeof QlooAgeBucket>;

export const QlooTrendBias = z.enum(["off", "very_low", "low", "medium", "high", "very_high"]);
export type QlooTrendBias = z.infer<typeof QlooTrendBias>;

/**
 * Era filters. Qloo supports a different one per type (see ERA_FILTER_SUPPORT);
 * the adapter sends only the filters valid for `type` and ignores the others,
 * because Qloo silently ignores unsupported params.
 */
export const TasteEraFilter = z
  .object({
    /** filter.release_year.min/max: movie, tv_show */
    releaseYear: YearRange.optional(),
    /** filter.publication_year.min/max: book */
    publicationYear: YearRange.optional(),
    /** filter.date_of_birth.min/max (YYYY-MM-DD): person */
    dateOfBirth: DateRange.optional(),
  })
  .strict();
export type TasteEraFilter = z.infer<typeof TasteEraFilter>;

/** GET /v2/insights */
export const TasteInsightsQuery = z
  .object({
    /** filter.type */
    type: QlooInsightsType,
    /** signal.interests.entities (Qloo ids of verified seeds). */
    seedEntityIds: z.array(QlooId).max(25).optional(),
    /** signal.interests.tags */
    seedTagIds: z.array(TagId).max(25).optional(),
    /** signal.location.query: a public place name ("Naples"). 400 if unknown: adapter retries once without it. */
    locationQuery: CulturalText.optional(),
    /** signal.demographics.age (an aggregate bucket, not the person's exact age). */
    ageBucket: QlooAgeBucket.optional(),
    era: TasteEraFilter.optional(),
    /** filter.tags (e.g. "urn:tag:genre:music:60s" for artists, which have no year filter). */
    filterTagIds: z.array(TagId).max(25).optional(),
    /** filter.exclude.entities */
    excludeEntityIds: z.array(QlooId).max(50).optional(),
    /** filter.popularity.min (0-1) */
    minPopularity: z.number().min(0).max(1).optional(),
    /** bias.trends. Adapter default "off": nostalgia, not what is trending now. */
    trendBias: QlooTrendBias.optional(),
    /** filter.exists=properties.image */
    requireImage: z.boolean().optional(),
    /** take (max 50). */
    take: z.number().int().min(1).max(50).optional(),
  })
  .strict();
export type TasteInsightsQuery = z.infer<typeof TasteInsightsQuery>;

/** GET /v2/tags */
export const TasteTagSearchQuery = z
  .object({
    /** filter.query: a genre/decade concept ("60s", "neapolitan song"). */
    query: CulturalText,
    /** filter.tag.types, e.g. ["urn:tag:genre:music"] */
    tagTypes: z.array(z.string().startsWith("urn:tag:").max(120)).max(5).optional(),
    take: z.number().int().min(1).max(50).optional(),
  })
  .strict();
export type TasteTagSearchQuery = z.infer<typeof TasteTagSearchQuery>;

/** GET /entities?entity_ids=... */
export const TasteLookupQuery = z.object({ qlooIds: z.array(QlooId).min(1).max(50) }).strict();
export type TasteLookupQuery = z.infer<typeof TasteLookupQuery>;

// ---------------------------------------------------------------------------
// Port
// ---------------------------------------------------------------------------

export interface TastePort {
  readonly mode: ProviderMode;
  /** Find entities by name within types. Ordered by Qloo match score. */
  search(query: TasteSearchQuery, ctx: CallContext): Promise<TasteResponse<TasteEntity>>;
  /** Batch lookup by Qloo id. Missing ids are omitted. */
  getEntities(query: TasteLookupQuery, ctx: CallContext): Promise<TasteResponse<TasteEntity>>;
  /** Cross-domain affinity recommendations. Ordered by affinity. */
  insights(query: TasteInsightsQuery, ctx: CallContext): Promise<TasteResponse<TasteEntity>>;
  /** Tag lookup (decade/genre tags used as filters for types without a year filter). */
  searchTags(query: TasteTagSearchQuery, ctx: CallContext): Promise<TasteResponse<TasteTag>>;
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

// ---------------------------------------------------------------------------
// Personal-data guard
// ---------------------------------------------------------------------------

const fold = (s: string) => s.normalize("NFKC").toLocaleLowerCase().trim();

function collectStrings(value: unknown, out: string[]): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => collectStrings(v, out));
  return out;
}

/**
 * Throws PortError("taste", "bad_request") if any string in `query` equals one
 * of `forbiddenTerms` or contains a multi-word forbidden term (case- and
 * Unicode-insensitive). Pass the person's display name (whole, plus each word
 * of it as an equality-only term). Exact structured comparison, not semantics.
 */
export function assertNoPersonalData(query: unknown, forbiddenTerms: readonly string[]): void {
  const terms = forbiddenTerms.map(fold).filter((t) => t.length >= 2);
  if (terms.length === 0) return;
  for (const raw of collectStrings(query, [])) {
    const s = fold(raw);
    const hit = terms.some((t) => s === t || (t.includes(" ") && s.includes(t)));
    if (hit) throw new PortError("taste", "bad_request", "Blocked a Qloo request that contained personal data", false);
  }
}

/** Forbidden terms for a display name: the full name plus each word of it. */
export function personalTermsFromDisplayName(displayName: string | undefined): string[] {
  if (!displayName) return [];
  const full = displayName.trim();
  return [full, ...full.split(" ").filter((w) => w.length >= 2)];
}

/** Decorates a TastePort so every outgoing query is checked with assertNoPersonalData. */
export function withPersonalDataGuard(port: TastePort, forbiddenTerms: readonly string[]): TastePort {
  return {
    mode: port.mode,
    search: (q, ctx) => (assertNoPersonalData(q, forbiddenTerms), port.search(q, ctx)),
    getEntities: (q, ctx) => (assertNoPersonalData(q, forbiddenTerms), port.getEntities(q, ctx)),
    insights: (q, ctx) => (assertNoPersonalData(q, forbiddenTerms), port.insights(q, ctx)),
    searchTags: (q, ctx) => (assertNoPersonalData(q, forbiddenTerms), port.searchTags(q, ctx)),
  };
}
