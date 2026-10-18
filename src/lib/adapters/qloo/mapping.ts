/**
 * Defensive mapping of raw Qloo JSON into port DTOs (docs/qloo-api.md
 * sections 2-4). Raw shapes are zod-validated with `.loose()` so extra fields
 * pass; each item is parsed on its own, and invalid items or unknown entity
 * types are dropped instead of failing the whole page.
 */
import { z } from "zod";

import { QLOO_ENTITY_TYPES } from "@/lib/domain/types";
import type { QlooEntityType } from "@/lib/domain/types";
import type { TasteEntity, TasteTag } from "@/lib/ports/taste";

const num = z.preprocess((v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v), z.number().finite());
const str = z.string();

const RawTag = z
  .object({ id: str.optional(), tag_id: str.optional(), name: str.optional(), type: str.optional(), subtype: str.optional() })
  .loose();

const RawLocalized = z.object({ value: str, languages: z.array(str).optional() }).loose();

const RawEntity = z
  .object({
    entity_id: str.optional(),
    id: str.optional(),
    name: str,
    type: str.optional(),
    subtype: str.optional(),
    types: z.array(str).optional(),
    popularity: num.optional(),
    disambiguation: str.optional(),
    properties: z
      .object({
        release_year: num.optional(),
        publication_year: num.optional(),
        release_date: str.optional(),
        date_of_birth: str.optional(),
        image: z.object({ url: str.optional() }).loose().optional(),
        short_description: str.optional(),
        description: str.optional(),
        short_descriptions: z.array(RawLocalized).optional(),
      })
      .loose()
      .optional(),
    tags: z.array(z.unknown()).optional(),
    query: z.object({ affinity: num.optional() }).loose().optional(),
  })
  .loose();

const KNOWN_TYPES = new Set<string>(QLOO_ENTITY_TYPES);
/** Spelling variants seen in the docs (docs/qloo-api.md 3.1). */
const TYPE_ALIASES: Record<string, QlooEntityType> = { "urn:entity:video_game": "urn:entity:videogame" };

function knownType(value: string | undefined): QlooEntityType | undefined {
  if (!value) return undefined;
  if (KNOWN_TYPES.has(value)) return value as QlooEntityType;
  return TYPE_ALIASES[value];
}

const unit = (v: number | undefined) => (v !== undefined && v >= 0 && v <= 1 ? v : undefined);

function yearFrom(props: z.infer<typeof RawEntity>["properties"]): number | undefined {
  const direct = props?.release_year ?? props?.publication_year;
  if (direct !== undefined && Number.isInteger(direct)) return direct;
  const date = props?.release_date;
  if (date && /^\d{4}/.test(date)) return Number(date.slice(0, 4));
  return undefined;
}

function englishDescription(props: z.infer<typeof RawEntity>["properties"]): string | undefined {
  const localized = props?.short_descriptions?.find((d) => d.languages?.includes("en"))?.value;
  const text = props?.short_description ?? localized ?? props?.description;
  return text?.trim() ? text.trim() : undefined;
}

export function mapTag(raw: unknown): TasteTag | undefined {
  const parsed = RawTag.safeParse(raw);
  if (!parsed.success) return undefined;
  const id = parsed.data.id ?? parsed.data.tag_id;
  if (!id || !id.startsWith("urn:tag:")) return undefined;
  const type = parsed.data.type ?? parsed.data.subtype;
  return { id, name: parsed.data.name ?? id, ...(type ? { type } : {}) };
}

export function mapEntity(raw: unknown): TasteEntity | undefined {
  const parsed = RawEntity.safeParse(raw);
  if (!parsed.success) return undefined;
  const e = parsed.data;
  const qlooId = e.entity_id ?? e.id;
  const type = knownType(e.subtype) ?? knownType(e.type) ?? e.types?.map(knownType).find(Boolean);
  if (!qlooId || !type || !e.name.trim()) return undefined;
  const p = e.properties;
  const entity: TasteEntity = { qlooId, name: e.name.trim(), type, tags: [] };
  const releaseYear = yearFrom(p);
  if (releaseYear !== undefined) entity.releaseYear = releaseYear;
  if (p?.date_of_birth) entity.dateOfBirth = p.date_of_birth;
  if (p?.image?.url) entity.imageUrl = p.image.url;
  const description = englishDescription(p);
  if (description) entity.description = description;
  if (e.disambiguation?.trim()) entity.disambiguation = e.disambiguation.trim();
  const popularity = unit(e.popularity);
  if (popularity !== undefined) entity.popularity = popularity;
  const affinity = unit(e.query?.affinity);
  if (affinity !== undefined) entity.affinity = affinity;
  entity.tags = (e.tags ?? []).map(mapTag).filter((t): t is TasteTag => t !== undefined);
  return entity;
}

const Envelope = z
  .object({
    results: z
      .union([z.array(z.unknown()), z.object({ entities: z.array(z.unknown()).optional(), tags: z.array(z.unknown()).optional() }).loose()])
      .optional(),
  })
  .loose();

/** Entities from `/search`, `/entities` (`results[]` or `results.entities[]`) and `/v2/insights` (`results.entities[]`). */
export function extractEntities(json: unknown): TasteEntity[] | undefined {
  const parsed = Envelope.safeParse(json);
  if (!parsed.success) return undefined;
  const results = parsed.data.results;
  const items = Array.isArray(results) ? results : (results?.entities ?? []);
  return items.map(mapEntity).filter((e): e is TasteEntity => e !== undefined);
}

/** Tags from `/v2/tags` (`results.tags[]`, tolerating `results[]`). */
export function extractTags(json: unknown): TasteTag[] | undefined {
  const parsed = Envelope.safeParse(json);
  if (!parsed.success) return undefined;
  const results = parsed.data.results;
  const items = Array.isArray(results) ? results : (results?.tags ?? results?.entities ?? []);
  return items.map(mapTag).filter((t): t is TasteTag => t !== undefined);
}
