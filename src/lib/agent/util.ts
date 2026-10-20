/**
 * Deterministic helpers for the agent: reshaping structured data only
 * (no semantic interpretation of text).
 */
import type { Anchors, QlooInsightsType, TasteDomain } from "@/lib/domain/types";
import { PortError } from "@/lib/ports/common";
import type { QlooAgeBucket, TasteEraFilter } from "@/lib/ports/taste";

/** Trim and cut a string to a schema limit; undefined when empty. */
export function clip(value: string | undefined | null, max: number): string | undefined {
  const s = value?.trim();
  if (!s) return undefined;
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

/** Exact-match normalization of entity names: Unicode-folded, accent-free, lower case, single spaces. */
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

/** Run `fn` over items with at most `limit` in flight; returns promises in input order. */
export function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R>[] {
  let active = 0;
  const queue: Array<() => void> = [];
  const next = () => {
    active--;
    queue.shift()?.();
  };
  return items.map(
    (item, index) =>
      new Promise<R>((resolve, reject) => {
        const start = () => {
          active++;
          fn(item, index).then(resolve, reject).finally(next);
        };
        if (active < limit) start();
        else queue.push(start);
      }),
  );
}

/**
 * A Qloo failure that means "Qloo itself is not usable right now" — the whole
 * run degrades to llm-only and the banner fires. Narrow on purpose: a single
 * per-query miss (bad_request from the guard/API, timeout for one slow entity,
 * invalid_response for one odd reply) is NOT a Qloo outage. Only genuine
 * service-level failures qualify: unreachable network, bad key, Qloo asking
 * us to back off across the board.
 */
export function isTasteOutage(error: unknown): error is PortError {
  if (!(error instanceof PortError) || error.port !== "taste") return false;
  return error.code === "unavailable" || error.code === "unauthorized" || error.code === "rate_limited";
}

/** Qloo's aggregate age bucket for a birth year (never the exact age). */
export function ageBucket(birthYear: number, currentYear: number): QlooAgeBucket {
  const age = currentYear - birthYear;
  if (age >= 55) return "55_and_older";
  if (age >= 45) return "45_to_54";
  if (age >= 35) return "35_to_44";
  if (age >= 30) return "30_to_34";
  if (age >= 25) return "25_to_29";
  return "24_and_younger";
}

/** Era filter for an arbitrary year window. The adapter sends only the one the type supports. */
export function eraFilterForWindow(startYear: number, endYear: number): TasteEraFilter {
  const pad = (y: number) => String(Math.max(0, y)).padStart(4, "0");
  return {
    releaseYear: { min: startYear, max: endYear },
    publicationYear: { min: startYear, max: endYear },
    // Public figures who were famous during the window: born up to ~70 years before it, and at least ~15 before it ended.
    dateOfBirth: { min: `${pad(startYear - 70)}-01-01`, max: `${pad(endYear - 15)}-12-31` },
  };
}

/** Era filter for the person's formative window. Default when no finer phase is known. */
export function eraFilter(anchors: Anchors): TasteEraFilter {
  const { startYear, endYear } = anchors.formativeWindow;
  return eraFilterForWindow(startYear, endYear);
}

/**
 * Era filter spanning every life phase in the anchors (childhood through
 * later_life). Used by cross-era EXPAND so Qloo affinity can return items
 * from any phase, not only the formative bump; the caller then re-partitions
 * returns to lifePhase labels in code.
 */
export function lifespanEraFilter(anchors: Anchors): TasteEraFilter {
  const phases = anchors.lifePhases;
  if (!phases || phases.length === 0) return eraFilter(anchors);
  const start = Math.min(...phases.map((p) => p.startYear));
  const end = Math.max(...phases.map((p) => p.endYear));
  return eraFilterForWindow(start, end);
}

/**
 * Hard lifetime safety rail. Returns a short reason when the entity's
 * relevant date sits outside the anchors' lifetime window (birth year
 * through today, inclusive), or undefined when the entity is in bounds or
 * carries no date signal. The caller rejects out-of-bounds entities with
 * kind `anachronism` and this reason, so the trace credits Qloo for the
 * catch rather than silently filtering. Date fields follow the Qloo
 * ERA_FILTER_SUPPORT map: releaseYear for movies/tv/books/videogames,
 * dateOfBirth for persons/artists/brands. Entities without a date (e.g.
 * places with no publication year) are not rejected on lifetime bounds;
 * cultural-check already covers the obvious wrong-culture cases.
 */
export function lifetimeViolation(
  anchors: Anchors,
  entity: { releaseYear?: number; bornYear?: number },
): string | undefined {
  const w = anchors.lifetimeWindow;
  if (!w) return undefined;
  if (entity.releaseYear !== undefined) {
    if (entity.releaseYear < w.startYear) {
      return `Released in ${entity.releaseYear}, before ${w.startYear}: the person had not been born yet.`;
    }
    if (entity.releaseYear > w.endYear) {
      return `Released in ${entity.releaseYear}, after the person's lifetime window (ends ${w.endYear}).`;
    }
  }
  if (entity.bornYear !== undefined) {
    if (entity.bornYear > w.endYear) {
      return `Born in ${entity.bornYear}, after the person's lifetime window (ends ${w.endYear}).`;
    }
    // A person active during someone's lifetime can still be born well before
    // them, so bornYear < startYear is not itself a violation.
  }
  return undefined;
}

/**
 * Narrow place-name normalizations for the hackathon Qloo tier. Not a general
 * alias table: just the one city the live probe found rejected under its
 * ASCII-folded form. "Fes" / "Fez" -> "Fès" (which Qloo accepts). Country-level
 * fallback is intentionally omitted: the probe showed country-level queries
 * returning 0 ("Ireland", "Morocco"), so when a city is unrecognised the agent
 * drops the location signal rather than widening it to a useless country.
 */
const PLACE_ALIASES: Record<string, string> = { fes: "Fès", fez: "Fès" };

export function normalizePlaceName(name: string): string {
  if (!name) return name;
  const compact = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();
  // City-only form, e.g. "fes", or "fes, morocco": take the first segment before a comma.
  const head = compact.split(",")[0].trim();
  const alias = PLACE_ALIASES[head];
  if (!alias) return name;
  // Preserve any trailing qualifiers from the original ("Fes, Morocco" -> "Fès, Morocco").
  const rest = name.includes(",") ? name.slice(name.indexOf(",")) : "";
  return `${alias}${rest}`;
}

/** The place used as `signal.location.query`: where they grew up, else the first place. */
export function primaryPlace(anchors: Anchors): string | undefined {
  const early = anchors.places.find((p) => p.role === "birthplace" || p.role === "childhood" || p.role === "youth");
  const name = (early ?? anchors.places[0])?.name;
  return name ? normalizePlaceName(name) : undefined;
}

/**
 * Structural "non-Western origin" signal for the critique's cultural-mismatch
 * gate (F2). Deliberately coarse: a country-code allowlist and a BCP-47 primary
 * subtag allowlist, both exact-equality checks. The semantic judgment itself
 * (does this affinity extrapolate off-culture?) is done by the LLM via
 * `cultural-check`; this helper only decides whether to run that check.
 */
const WESTERN_COUNTRY_CODES = new Set([
  "US", "CA", "GB", "IE", "FR", "DE", "IT", "ES", "PT", "NL", "BE", "LU",
  "SE", "NO", "DK", "FI", "IS", "AT", "CH", "AU", "NZ", "GR", "PL", "CZ",
  "SK", "HU", "RO", "BG", "HR", "SI", "EE", "LT", "LV", "MT", "CY",
]);
/** Primary BCP-47 subtags strongly suggesting non-Western cultural origin. */
const NON_WESTERN_LANG_PRIMARY = new Set([
  "ar", "he", "fa", "ur", "hi", "bn", "pa", "ta", "te", "ml", "kn", "mr",
  "zh", "ja", "ko", "vi", "th", "id", "ms", "tr", "az", "ka", "hy", "am",
  "sw", "yo", "ha", "ig", "zu",
]);

export function primarySubtag(tag: string): string {
  return tag.toLowerCase().split("-")[0] ?? tag.toLowerCase();
}

export function isNonWesternOrigin(anchors: Anchors, sessionLanguage: string): boolean {
  if (NON_WESTERN_LANG_PRIMARY.has(primarySubtag(sessionLanguage))) return true;
  for (const place of anchors.places) {
    const code = place.countryCode?.toUpperCase();
    if (code && !WESTERN_COUNTRY_CODES.has(code)) return true;
  }
  return false;
}

/** Insights target type per domain for EXPAND (the domain's Qloo type that supports affinity well). */
export const EXPAND_TARGET: Partial<Record<TasteDomain, QlooInsightsType>> = {
  music: "urn:entity:artist",
  film: "urn:entity:movie",
  television: "urn:entity:tv_show",
  public_figure: "urn:entity:person",
  sport: "urn:entity:person",
  book: "urn:entity:book",
};

/** Domain for an entity found by affinity of a given type. */
export const DOMAIN_OF_TYPE: Partial<Record<QlooInsightsType, TasteDomain>> = {
  "urn:entity:artist": "music",
  "urn:entity:movie": "film",
  "urn:entity:tv_show": "television",
  "urn:entity:person": "public_figure",
  "urn:entity:book": "book",
};

/**
 * Scale step durations (whole minutes, 1-30 each) so they sum to `total`
 * (largest remainder). If that is impossible within the bounds, the sum is
 * as close as the bounds allow.
 */
export function normalizeDurations(raw: number[], total: number): number[] {
  const n = raw.length;
  if (n === 0) return [];
  const target = Math.min(Math.max(total, n), n * 30);
  const weights = raw.map((d) => (Number.isFinite(d) && d > 0 ? d : 1));
  const sum = weights.reduce((a, b) => a + b, 0);
  const exact = weights.map((w) => (w / sum) * target);
  const out = exact.map((x) => Math.min(30, Math.max(1, Math.floor(x))));
  let diff = target - out.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let guard = 0; diff !== 0 && guard < 10 * n; guard++) {
    const [, i] = order[guard % n];
    if (diff > 0 && out[i] < 30) {
      out[i]++;
      diff--;
    } else if (diff < 0 && out[i] > 1) {
      out[i]--;
      diff++;
    }
  }
  return out;
}
