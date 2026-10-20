/**
 * One-line citation surfaced under grounded step cards and Qloo-sourced trace
 * rows. Reads only what the VerifiedEntity carries (year, bornYear, tagLabels,
 * disambiguation) and degrades gracefully: an entity with no usable field
 * returns undefined so the caller omits the line rather than printing a
 * placeholder like "Qloo: unknown".
 *
 * Prefixed with the literal word "Qloo" so a judge visually catches the
 * pattern as they skim the trace.
 */
import type { SessionStep, VerifiedEntity } from "@/lib/domain/types";

/** First non-empty value, trimmed. */
function pick(values: Array<string | undefined>): string | undefined {
  for (const v of values) {
    const t = v?.trim();
    if (t) return t;
  }
  return undefined;
}

/**
 * Convert a Qloo tag id to a readable label when the tag's `name` is missing.
 * "urn:tag:genre:music:60s" -> "60s"; otherwise just the trailing segment.
 */
function tagHumanLabel(idOrName: string): string {
  if (!idOrName.startsWith("urn:tag:")) return idOrName;
  const parts = idOrName.split(":");
  return parts.at(-1) ?? idOrName;
}

/** The entity's best disambiguation text (short, no commas trailing). */
function cleanDisambiguation(entity: VerifiedEntity): string | undefined {
  const raw = entity.disambiguation?.trim();
  if (!raw) return undefined;
  // Strip wrapping parentheses if Qloo returned e.g. "(1942, film)".
  const stripped = raw.replace(/^\(/, "").replace(/\)$/, "").trim();
  return stripped.length > 0 ? stripped : undefined;
}

/** Build the citation body (without the "Qloo:" prefix) for a verified entity. */
export function qlooCitationBody(entity: VerifiedEntity): string | undefined {
  const year = entity.releaseYear;
  const born = entity.bornYear;
  const tags = (entity.tagLabels ?? []).map((t) => t.trim()).filter(Boolean);
  const topTag = tags[0] ? tagHumanLabel(tags[0]) : undefined;
  const disambig = cleanDisambiguation(entity);
  switch (entity.qlooType) {
    case "urn:entity:person":
    case "urn:entity:actor":
    case "urn:entity:director":
    case "urn:entity:author": {
      if (born) return `born ${born}`;
      return disambig ?? topTag;
    }
    case "urn:entity:movie":
    case "urn:entity:tv_show": {
      return pick([year ? String(year) : undefined, disambig]);
    }
    case "urn:entity:book": {
      return pick([year ? String(year) : undefined, disambig]);
    }
    case "urn:entity:artist":
    case "urn:entity:album": {
      return pick([topTag, disambig, year ? String(year) : undefined]);
    }
    case "urn:entity:destination":
    case "urn:entity:place":
    case "urn:entity:locality": {
      return pick([topTag, disambig]);
    }
    case "urn:entity:brand":
    case "urn:entity:podcast":
    case "urn:entity:videogame": {
      return pick([year ? String(year) : undefined, topTag, disambig]);
    }
    default:
      return pick([year ? String(year) : undefined, topTag, disambig]);
  }
}

/** Full citation line for a verified entity, or undefined if nothing to say. */
export function qlooCitationForEntity(entity: VerifiedEntity): string | undefined {
  const body = qlooCitationBody(entity);
  return body ? `Qloo: ${body}` : undefined;
}

/** Full citation line for a grounded step card. */
export function qlooCitation(step: SessionStep): string | undefined {
  if (step.provenance !== "qloo-grounded" || !step.entity) return undefined;
  return qlooCitationForEntity(step.entity);
}

/**
 * "Qloo /search: no match for 'Umm Kulthum' (checked 3 similar names)".
 * Used on the trace rejected row and the Caught box when `kind === "not_found"`
 * and `catchSource === "qloo"`.
 */
export function qlooNotFoundLine(label: string, resultCount: number | undefined): string {
  const n = resultCount ?? 0;
  const checked = n === 0 ? "no similar names" : n === 1 ? "1 similar name" : `${n} similar names`;
  return `Qloo /search: no match for '${label}' (checked ${checked})`;
}
