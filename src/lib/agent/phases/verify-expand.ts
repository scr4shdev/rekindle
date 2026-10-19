/**
 * VERIFY (does each groundable candidate exist in Qloo?) and EXPAND
 * (cross-domain affinity from verified seeds, era-filtered). Qloo calls run
 * with bounded concurrency; events are emitted in input order so the trace
 * and ids are deterministic. A Qloo outage degrades to llm-only material.
 */
import type { AgentEventPayload, Anchors, Candidate, QlooInsightsType, VerifiedEntity } from "@/lib/domain/types";
import { QLOO_INSIGHTS_TYPES } from "@/lib/domain/types";
import type { TasteEntity } from "@/lib/ports";
import { PortError } from "@/lib/ports";
import { matchEntityPrompt } from "@/lib/prompts";

import type { Material, Run } from "@/lib/agent/run";
import { bornYearOf, callLlm, callTaste, errorFromQloo, qlooCallEvent, toVerifiedEntity } from "@/lib/agent/run";
import { ageBucket, clip, DOMAIN_OF_TYPE, eraFilter, EXPAND_TARGET, isTasteOutage, mapLimit, normalizeName, primaryPlace } from "@/lib/agent/util";

/** Parallel Qloo searches in VERIFY (bounded to stay polite to the API, HARD RULE 6). */
export const VERIFY_CONCURRENCY = 4;
/** Results shown to the match-entity LLM call when no exact name match exists. */
export const MATCH_RESULTS = 5;
/** At most this many insights targets (types) per run, and seeds per call. */
export const EXPAND_MAX_TARGETS = 4;
export const EXPAND_MAX_SEEDS = 5;
/** Tag results looked at per decade query (only an exact decade id is used). */
export const DECADE_TAG_TAKE = 3;
const TARGET_PRIORITY: QlooInsightsType[] = ["urn:entity:artist", "urn:entity:movie", "urn:entity:person", "urn:entity:tv_show", "urn:entity:book"];

export function ideaMaterial(candidate: Candidate): Material {
  return { ref: candidate.id, label: candidate.name, domain: candidate.domain, year: candidate.year, source: "llm-idea", candidate };
}

export function entityMaterial(entity: VerifiedEntity, raw: TasteEntity, candidate?: Candidate): Material {
  return {
    ref: entity.id,
    label: entity.name,
    domain: entity.domain,
    year: entity.releaseYear ?? candidate?.year,
    bornYear: bornYearOf(raw),
    description: entity.description,
    source: entity.provenance === "qloo-affinity" ? "qloo-affinity" : "qloo-verified",
    entity,
    candidate,
  };
}

type VerifyOutcome =
  | { kind: "found"; entity: TasteEntity; events: AgentEventPayload[]; matchedBy: "exact" | "llm" }
  | { kind: "not_found"; events: AgentEventPayload[]; reason: string }
  | { kind: "outage"; error: PortError };

async function verifyOne(run: Run, candidate: Candidate): Promise<VerifyOutcome> {
  const type = candidate.qlooType!;
  let response;
  try {
    response = await callTaste(run, (taste, ctx) => taste.search({ query: candidate.name, types: [type], take: run.deps.config.qloo.defaultTake }, ctx));
  } catch (error) {
    // Bugs are not "not found": only port errors are handled here.
    if (!(error instanceof PortError)) throw error;
    if (isTasteOutage(error)) return { kind: "outage", error };
    // bad_request: the guard or the API refused this one query. Nothing personal is ever sent.
    return { kind: "not_found", events: [], reason: "Not checked: the query was refused, so it is not used." };
  }
  const events = [qlooCallEvent(run, "verify", response)];
  const sameType = response.items.filter((e) => e.type === type);
  const wanted = normalizeName(candidate.name);
  const exact = sameType.filter((e) => normalizeName(e.name) === wanted);
  if (exact.length > 0) {
    const best = candidate.year
      ? [...exact].sort((a, b) => Math.abs((a.releaseYear ?? candidate.year!) - candidate.year!) - Math.abs((b.releaseYear ?? candidate.year!) - candidate.year!))[0]
      : exact[0];
    return { kind: "found", entity: best, events, matchedBy: "exact" };
  }
  const shortlist = sameType.slice(0, MATCH_RESULTS);
  if (shortlist.length > 0) {
    try {
      const match = await callLlm(
        run,
        matchEntityPrompt,
        {
          candidate: { name: candidate.name, domain: candidate.domain, qlooType: type, year: candidate.year },
          results: shortlist.map((e, index) => ({
            index,
            name: e.name,
            type: e.type,
            year: e.releaseYear,
            bornYear: bornYearOf(e),
            disambiguation: clip(e.disambiguation, 200),
            description: clip(e.description, 200),
          })),
        },
        false,
      );
      const picked = shortlist[match.matchIndex];
      if (picked && match.confidence !== "low") return { kind: "found", entity: picked, events, matchedBy: "llm" };
    } catch (error) {
      run.ctx.logger.warn({ phase: "verify", err: error instanceof Error ? error.name : typeof error }, "match-entity failed; treating as not found");
    }
  }
  return { kind: "not_found", events, reason: "No confident match in Qloo; not used." };
}

/** Qloo tag parent type used to filter cuisine-cultural tags (F3). */
export const CUISINE_TAG_PARENT = "urn:tag:cuisine";

/**
 * Cuisine-tag side-lookup (F3): food candidates have no "dish" type in Qloo,
 * so a plain /search returns offices and airports. Instead we look for a
 * cuisine tag that matches the person's cultural background and gate food
 * candidates on it: tag found -> food stays as caregiver-led ideas (with the
 * tag id surfaced for the trace); tag not found -> food is dropped so the
 * plan omits a food step rather than suggesting an airport.
 */
/** First comma-separated token of a free-text classifier (structural reshape only). */
function cuisineHints(anchors: Anchors): string[] {
  const seen = new Set<string>();
  const push = (raw: string | undefined) => {
    const t = raw?.split(",")[0]?.trim();
    if (t && !seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase());
    }
    return t;
  };
  const out: string[] = [];
  const bg = push(anchors.culturalBackground);
  if (bg) out.push(bg);
  // Fallback: the primary place name itself (e.g. "Naples", "Fès").
  const place = push(anchors.places[0]?.name);
  if (place) out.push(place);
  return out;
}

type CuisineResult = { tag: { id: string; name: string } | undefined; event: AgentEventPayload } | { outage: PortError };

async function resolveCuisineTag(run: Run, anchors: Anchors): Promise<CuisineResult | undefined> {
  const hints = cuisineHints(anchors);
  if (hints.length === 0) return undefined;
  let event: AgentEventPayload | undefined;
  for (const hint of hints) {
    try {
      const res = await callTaste(run, (taste, ctx) =>
        taste.searchTags({ query: hint, tagTypes: [CUISINE_TAG_PARENT], take: 5 }, ctx),
      );
      event = qlooCallEvent(run, "verify", res);
      const tag = res.items.find((t) => t.id.startsWith(`${CUISINE_TAG_PARENT}:`) || t.type === CUISINE_TAG_PARENT);
      if (tag) return { tag, event };
    } catch (error) {
      if (isTasteOutage(error)) return { outage: error };
    }
  }
  return event ? { tag: undefined, event } : undefined;
}

export async function* verifyPhase(run: Run, anchors: Anchors, candidates: Candidate[]): AsyncGenerator<AgentEventPayload, Material[]> {
  const started = run.deps.now().getTime();
  yield { type: "phase", phase: "verify", status: "started", message: "Checking each idea against Qloo's cultural graph…" };
  const groundable = candidates.filter((c) => c.qlooType);
  const ungroundable = candidates.filter((c) => !c.qlooType);
  const foodCandidates = ungroundable.filter((c) => c.domain === "food");
  const otherUngroundable = ungroundable.filter((c) => c.domain !== "food");

  // F3: cuisine-tag gate for food candidates.
  let foodDecision: "keep" | "drop" = "keep";
  let cuisineTagName: string | undefined;
  if (foodCandidates.length > 0 && !run.qlooDown) {
    const resolved = await resolveCuisineTag(run, anchors);
    if (resolved && "outage" in resolved) {
      // Qloo is down. The main verify loop below will emit the single
      // user-facing error event; here we just mark the run and keep food as
      // caregiver-led ideas (don't drop them when Qloo itself is unavailable).
      run.qlooDown = true;
      run.ctx.logger.warn({ phase: "verify", code: resolved.outage.code }, "qloo unavailable; degrading to llm-only");
      yield errorFromQloo(resolved.outage, "verify");
      foodDecision = "keep";
    } else if (resolved) {
      yield resolved.event;
      if (resolved.tag) {
        cuisineTagName = resolved.tag.name;
      } else {
        foodDecision = "drop";
      }
    } else {
      // No cultural hint to query: drop food (the plan omits a food step
      // rather than reaching Qloo without a cuisine filter).
      foodDecision = "drop";
    }
  }
  const outcomes = mapLimit(groundable, VERIFY_CONCURRENCY, (c) => verifyOne(run, c));
  // If one outcome throws, the rest are never awaited: keep their rejections handled.
  for (const outcome of outcomes) outcome.catch(() => undefined);
  const materials: Material[] = [];
  let verified = 0;
  let notFound = 0;
  let degraded = 0;

  for (let i = 0; i < groundable.length; i++) {
    const candidate = groundable[i];
    const outcome = await outcomes[i];
    if (outcome.kind === "outage") {
      if (!run.qlooDown) {
        run.qlooDown = true;
        run.ctx.logger.warn({ phase: "verify", code: outcome.error.code }, "qloo unavailable; degrading to llm-only");
        yield errorFromQloo(outcome.error, "verify");
      }
      degraded++;
      materials.push(ideaMaterial(candidate));
      continue;
    }
    yield* outcome.events;
    if (outcome.kind === "found") {
      const entity = toVerifiedEntity(run, outcome.entity, candidate.domain, { provenance: "llm-proposed-qloo-verified", candidateId: candidate.id });
      verified++;
      run.stats.verified++;
      yield { type: "verified", entity };
      materials.push(entityMaterial(entity, outcome.entity, candidate));
    } else {
      notFound++;
      run.stats.rejected++;
      yield { type: "rejected", item: { label: candidate.name, reason: outcome.reason, kind: "not_found", phase: "verify", domain: candidate.domain, refId: candidate.id } };
    }
  }

  const keptFood = foodDecision === "keep" ? foodCandidates : [];
  const droppedFood = foodDecision === "drop" ? foodCandidates : [];
  const ungroundableKept = [...otherUngroundable, ...keptFood];
  if (ungroundableKept.length > 0) {
    const names = ungroundableKept.map((c) => c.name).join(", ");
    const cuisineNote = cuisineTagName ? ` Food linked to ${cuisineTagName} cuisine.` : "";
    yield { type: "note", phase: "verify", text: clip(`${names}: not something Qloo lists (for example a dish), so kept as caregiver-led ideas.${cuisineNote}`, 400)! };
    materials.push(...ungroundableKept.map(ideaMaterial));
  }
  for (const c of droppedFood) {
    run.stats.rejected++;
    yield { type: "rejected", item: { label: c.name, reason: "No matching cuisine in Qloo for this cultural background, so the food step is omitted.", kind: "not_found", phase: "verify", domain: c.domain, refId: c.id } };
  }
  const checkable = groundable.length - degraded;
  yield {
    type: "phase",
    phase: "verify",
    status: "completed",
    message: run.qlooDown ? `Qloo became unavailable: ${verified} confirmed, the rest stay as unverified ideas.` : `${verified} of ${checkable} checkable ideas confirmed in Qloo.`,
    durationMs: run.deps.now().getTime() - started,
    counts: { verified, notFound: notFound + droppedFood.length, unverifiable: ungroundableKept.length + degraded },
  };
  return materials;
}

export async function* expandPhase(run: Run, anchors: Anchors, materials: Material[]): AsyncGenerator<AgentEventPayload, Material[]> {
  const max = run.deps.config.agent.maxExpansionsPerDomain;
  const seeds = materials.filter((m) => m.entity);
  const skip = run.qlooDown ? "Qloo is unavailable, so no cross-domain discoveries this time." : seeds.length === 0 ? "Nothing was confirmed in Qloo to expand from." : max === 0 ? "Cross-domain discovery is turned off." : undefined;
  if (skip) {
    yield { type: "phase", phase: "expand", status: "skipped", message: skip };
    return [];
  }
  const started = run.deps.now().getTime();
  const { startYear, endYear } = anchors.formativeWindow;
  yield { type: "phase", phase: "expand", status: "started", message: `Asking Qloo what else people with these tastes enjoy, limited to ${startYear}-${endYear}…` };

  const targets = TARGET_PRIORITY.filter((t) => seeds.some((m) => EXPAND_TARGET[m.domain] === t)).slice(0, EXPAND_MAX_TARGETS);
  const known = new Set(seeds.map((m) => m.entity!.qlooId));
  const knownNames = new Set(materials.map((m) => normalizeName(m.label)));
  const location = primaryPlace(anchors);
  const bucket = ageBucket(anchors.birthYear, run.deps.now().getUTCFullYear());
  const era = eraFilter(anchors);
  const found: Material[] = [];
  let calls = 0;

  // Decade tags for artists, which have no year filter (used as a ranking signal, not a hard filter).
  const tagIds: string[] = [];
  if (targets.includes("urn:entity:artist")) {
    const decades: number[] = [];
    for (let d = Math.floor(startYear / 10) * 10; d <= endYear && decades.length < 3; d += 10) decades.push(d);
    for (const decade of decades) {
      const label = `${String(decade % 100).padStart(2, "0")}s`;
      try {
        const res = await callTaste(run, (taste, ctx) => taste.searchTags({ query: label, tagTypes: ["urn:tag:genre:music"], take: DECADE_TAG_TAKE }, ctx));
        calls++;
        yield qlooCallEvent(run, "expand", res);
        // Exact id check only (e.g. "urn:tag:genre:music:60s"): never a fuzzy tag match.
        tagIds.push(...res.items.filter((t) => t.id.split(":").at(-1) === label).map((t) => t.id));
      } catch (error) {
        if (isTasteOutage(error)) {
          run.qlooDown = true;
          yield errorFromQloo(error, "expand");
          break;
        }
      }
    }
  }

  const plans = run.qlooDown
    ? []
    : targets.map((type) => {
        const ordered = [...seeds.filter((m) => m.entity!.qlooType === type), ...seeds.filter((m) => m.entity!.qlooType !== type)];
        const seedIds = [...new Set(ordered.map((m) => m.entity!.qlooId))].slice(0, EXPAND_MAX_SEEDS);
        return { type, seedIds };
      });
  const responses = plans.map(({ type, seedIds }) =>
    callTaste(run, (taste, ctx) =>
      taste.insights(
        {
          type,
          seedEntityIds: seedIds,
          seedTagIds: type === "urn:entity:artist" && tagIds.length ? tagIds : undefined,
          locationQuery: location,
          ageBucket: bucket,
          era,
          excludeEntityIds: [...known].slice(0, 50),
          trendBias: "off",
          take: Math.min(50, max * 2),
        },
        ctx,
      ),
    ).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    ),
  );

  for (let i = 0; i < plans.length; i++) {
    const res = await responses[i];
    if (!res.ok) {
      if (isTasteOutage(res.error) && !run.qlooDown) {
        run.qlooDown = true;
        yield errorFromQloo(res.error, "expand");
      }
      continue;
    }
    calls++;
    yield qlooCallEvent(run, "expand", res.value);
    const { type, seedIds } = plans[i];
    const hasYear = type === "urn:entity:movie" || type === "urn:entity:tv_show" || type === "urn:entity:book";
    let added = 0;
    for (const raw of res.value.items) {
      if (added >= max) break;
      if (known.has(raw.qlooId) || knownNames.has(normalizeName(raw.name)) || !QLOO_INSIGHTS_TYPES.includes(raw.type as QlooInsightsType)) continue;
      if (hasYear && raw.releaseYear !== undefined && (raw.releaseYear < startYear || raw.releaseYear > endYear)) continue;
      known.add(raw.qlooId);
      knownNames.add(normalizeName(raw.name));
      const entity = toVerifiedEntity(run, raw, DOMAIN_OF_TYPE[type] ?? "public_figure", { provenance: "qloo-affinity", seedQlooIds: seedIds });
      run.stats.verified++;
      added++;
      yield { type: "verified", entity };
      found.push(entityMaterial(entity, raw));
    }
  }

  yield {
    type: "phase",
    phase: "expand",
    status: "completed",
    message: `${found.length} era-matched discoveries from Qloo affinity (what people with similar tastes also enjoy).`,
    durationMs: run.deps.now().getTime() - started,
    counts: { expanded: found.length, calls },
  };
  return found;
}
