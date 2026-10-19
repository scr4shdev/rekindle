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
 * A Qloo failure that means "Qloo is not usable right now" (degrade to
 * llm-only), as opposed to a single rejected query (bad_request: e.g. blocked
 * by the personal-data guard or an unknown name).
 */
export function isTasteOutage(error: unknown): error is PortError {
  return error instanceof PortError && error.port === "taste" && error.code !== "bad_request";
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

/** Era filter for the person's formative window. The adapter sends only the one the type supports. */
export function eraFilter(anchors: Anchors): TasteEraFilter {
  const { startYear, endYear } = anchors.formativeWindow;
  const pad = (y: number) => String(Math.max(0, y)).padStart(4, "0");
  return {
    releaseYear: { min: startYear, max: endYear },
    publicationYear: { min: startYear, max: endYear },
    // Public figures who were famous during the window: born up to ~70 years before it, and at least ~15 before it ended.
    dateOfBirth: { min: `${pad(startYear - 70)}-01-01`, max: `${pad(endYear - 15)}-12-31` },
  };
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
