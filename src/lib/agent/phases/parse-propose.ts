/**
 * PARSE (notes -> anchors) and PROPOSE (anchors -> candidates). Both go
 * through the LLM; code only validates, clips and caps the structured output.
 */
import type { AgentEventPayload, Anchors, Candidate, LifePhase, LifePhaseLabel, PersonInput, TasteDomain } from "@/lib/domain/types";
import { Anchors as AnchorsSchema, Candidate as CandidateSchema, LanguageTag, LifePhaseLabel as LifePhaseLabelSchema, TASTE_DOMAIN_QLOO_TYPES, TASTE_DOMAINS, Year } from "@/lib/domain/types";
import { parseAnchorsPrompt, proposeCandidatesPrompt } from "@/lib/prompts";
import type { ParseAnchorsOutput } from "@/lib/prompts/parse-anchors";
import type { ProposeCandidatesOutput } from "@/lib/prompts/propose-candidates";

import type { Run } from "@/lib/agent/run";
import { callLlm } from "@/lib/agent/run";
import { clip, normalizeName } from "@/lib/agent/util";

const year = (v: number | undefined) => {
  const parsed = Year.safeParse(v);
  return parsed.success && v !== 0 ? parsed.data : undefined;
};

/**
 * Default phase ranges from the person's birth year. Deterministic: no notes
 * are read here, these are the five canonical reminiscence phases. Each
 * window is clipped to [birthYear, currentYear] so phases that have not
 * happened yet (a 72-year-old has not reached later_life, which starts at
 * 78) are dropped. The windows overlap on purpose: a childhood tune may
 * still have been playing in youth, and the formative bump (12-25) crosses
 * youth into early_adulthood.
 */
const PHASE_BOUNDS: Array<{ label: LifePhaseLabel; from: number; to: number }> = [
  { label: "childhood", from: 0, to: 8 },
  { label: "youth", from: 8, to: 21 },
  { label: "early_adulthood", from: 21, to: 36 },
  { label: "mid_life", from: 36, to: 58 },
  { label: "later_life", from: 58, to: 78 },
];

export function deriveLifePhases(birthYear: number, currentYear: number): LifePhase[] {
  const out: LifePhase[] = [];
  for (const { label, from, to } of PHASE_BOUNDS) {
    const start = birthYear + from;
    const end = birthYear + to;
    if (start > currentYear) break;
    const clippedEnd = Math.min(end, currentYear);
    if (clippedEnd <= start) continue;
    out.push({ label, startYear: start, endYear: clippedEnd, ageRange: `${from}-${to}` });
  }
  return out;
}

/** Pick the phase whose window covers `year`, or the nearest one by distance. */
export function phaseForYear(phases: readonly LifePhase[], year: number): LifePhaseLabel | undefined {
  if (phases.length === 0) return undefined;
  const covering = phases.find((p) => year >= p.startYear && year <= p.endYear);
  if (covering) return covering.label;
  // Nearest by edge distance; stable on ties by walking phases in order.
  let best = phases[0];
  let bestD = Math.min(Math.abs(year - best.startYear), Math.abs(year - best.endYear));
  for (const p of phases.slice(1)) {
    const d = Math.min(Math.abs(year - p.startYear), Math.abs(year - p.endYear));
    if (d < bestD) {
      best = p;
      bestD = d;
    }
  }
  return best.label;
}

export function toAnchors(out: ParseAnchorsOutput, person: PersonInput, run: Run): Anchors {
  const { formativeAgeMin, formativeAgeMax } = run.deps.config.agent;
  const currentYear = run.deps.now().getUTCFullYear();
  const modelYear = year(out.birthYear);
  const birthYear = person.birthYear ?? modelYear ?? currentYear - 80;
  // Stated only when the caregiver gave it, or the model says the notes state it; a fallback is always inferred.
  const birthYearSource = person.birthYear ? "stated" : modelYear !== undefined ? out.birthYearSource : "inferred";
  const startYear = Math.min(birthYear + formativeAgeMin, currentYear);
  const endYear = Math.min(birthYear + formativeAgeMax, currentYear);
  const lifePhases = deriveLifePhases(birthYear, currentYear);
  // Hard lifetime bounds. deathYear is not in PersonInput today, so the end
  // is pinned to the current year; a future contract widening can carry
  // deathYear and tighten the upper bound.
  const lifetimeWindow = { startYear: birthYear, endYear: currentYear };

  const places = out.places
    .map((p) => ({
      name: clip(p.name, 120),
      countryCode: /^[A-Za-z]{2}$/.test(p.countryCode) ? p.countryCode.toUpperCase() : undefined,
      role: p.role,
      fromYear: year(p.fromYear),
      toYear: year(p.toYear),
    }))
    .filter((p): p is typeof p & { name: string } => Boolean(p.name))
    .slice(0, 8);
  if (places.length === 0 && person.birthPlace) places.push({ name: person.birthPlace, countryCode: undefined, role: "birthplace", fromYear: birthYear, toYear: undefined });

  const languages = out.languages
    .filter((l) => LanguageTag.safeParse(l.tag).success)
    .map((l) => ({ tag: l.tag, name: clip(l.name, 60) ?? l.tag }))
    .slice(0, 5);
  if (languages.length === 0) languages.push({ tag: person.sessionLanguage, name: person.sessionLanguage });

  return AnchorsSchema.parse({
    birthYear,
    birthYearSource,
    formativeWindow: { startYear, endYear },
    lifePhases: lifePhases.length ? lifePhases : undefined,
    lifetimeWindow,
    places,
    languages,
    loves: out.loves
      .map((l) => ({ label: clip(l.label, 120), domain: l.domain, source: l.source }))
      .filter((l) => l.label)
      .slice(0, 20),
    sensitivities: out.sensitivities
      .map((s) => ({ topic: clip(s.topic, 120), reason: clip(s.reason, 280) ?? "Noted by the caregiver.", severity: s.severity }))
      .filter((s) => s.topic)
      .slice(0, 10),
    occupation: clip(out.occupation, 120),
    culturalBackground: clip(out.culturalBackground, 200),
    summary: clip(out.summary, 600) ?? `Person born in ${birthYear}.`,
    callbacks: out.callbacks
      ?.map((c) => clip(c, 240))
      .filter((c): c is string => Boolean(c))
      .slice(0, 4),
  });
}

export async function* parsePhase(run: Run, person: PersonInput): AsyncGenerator<AgentEventPayload, { anchors: Anchors; privateNames: string[] }> {
  const started = run.deps.now().getTime();
  const about = person.displayName ? ` about ${person.displayName}` : "";
  yield { type: "phase", phase: "parse", status: "started", message: `Reading your notes${about}…` };
  const out = await callLlm(
    run,
    parseAnchorsPrompt,
    {
      notes: person.notes,
      birthYear: person.birthYear,
      birthPlace: person.birthPlace,
      sessionLanguage: person.sessionLanguage,
      caregiverLanguage: person.caregiverLanguage,
      currentYear: run.deps.now().getUTCFullYear(),
      formativeAgeMin: run.deps.config.agent.formativeAgeMin,
      formativeAgeMax: run.deps.config.agent.formativeAgeMax,
      culturalBackground: person.culturalBackground,
      keyLifeEvents: person.keyLifeEvents,
      calmingCues: person.calmingCues,
      thingsToAvoid: person.thingsToAvoid,
      routines: person.routines,
      stage: person.stage,
    },
    true,
  );
  const anchors = toAnchors(out, person, run);
  yield { type: "anchors", anchors };
  const { startYear, endYear } = anchors.formativeWindow;
  const place = anchors.places[0]?.name;
  yield { type: "note", phase: "parse", text: `Born ${anchors.birthYear}, so the formative years are roughly ${startYear}-${endYear}${place ? `, in ${place}` : ""}.` };
  for (const text of out.notes) {
    const t = clip(text, 400);
    if (t) yield { type: "note", phase: "parse", text: t };
  }
  const langs = anchors.languages.map((l) => l.name).join(" and ");
  yield {
    type: "phase",
    phase: "parse",
    status: "completed",
    message: clip(`Understood: ${place ? `${place}, ` : ""}${startYear}-${endYear}, ${langs}.`, 400)!,
    durationMs: run.deps.now().getTime() - started,
    counts: { loves: anchors.loves.length, sensitivities: anchors.sensitivities.length },
  };
  return { anchors, privateNames: out.privateNames.map((n) => n.trim()).filter(Boolean) };
}

export function toCandidates(out: ProposeCandidatesOutput, run: Run, anchors?: Anchors): Candidate[] {
  const perDomain = new Map<TasteDomain, number>();
  const seen = new Set<string>();
  const max = run.deps.config.agent.maxCandidatesPerDomain;
  const phases = anchors?.lifePhases ?? [];
  const result: Candidate[] = [];
  for (const c of out.candidates) {
    const name = clip(c.name, 160);
    if (!name) continue;
    const key = normalizeName(name);
    const count = perDomain.get(c.domain) ?? 0;
    if (seen.has(key) || count >= max) continue;
    const allowed = TASTE_DOMAIN_QLOO_TYPES[c.domain];
    // Food in Qloo has no "dish" type: urn:entity:place is coarse and returns
    // offices/airports when there is no cuisine filter (live probe, F3). Keep
    // food candidates as ungroundable ideas and let the verify phase do a
    // cuisine-tag side-lookup as the cultural gate instead.
    const qlooType =
      c.qlooType === "none"
        ? undefined
        : c.domain === "food"
          ? undefined
          : allowed.includes(c.qlooType)
            ? c.qlooType
            : allowed[0];
    const candidateYear = year(c.year);
    const emitted = c.lifePhase && c.lifePhase !== "none" ? LifePhaseLabelSchema.safeParse(c.lifePhase) : undefined;
    // Year-derived phase wins when the year is known: the LLM (especially
    // qwen3:8b) tends to over-label everything as "childhood"; the candidate's
    // year is a fact we can project onto the person's actual phase bounds.
    const lifePhase =
      candidateYear !== undefined && phases.length > 0
        ? phaseForYear(phases, candidateYear)
        : emitted?.success
          ? emitted.data
          : undefined;
    const parsed = CandidateSchema.safeParse({
      id: run.deps.newId("c"),
      domain: c.domain,
      name,
      qlooType,
      year: candidateYear,
      lifePhase,
      rationale: clip(c.rationale, 400) ?? "Fits the era and places in the notes.",
    });
    if (!parsed.success) continue;
    seen.add(key);
    perDomain.set(c.domain, count + 1);
    result.push(parsed.data);
  }
  return result;
}

export async function* proposePhase(run: Run, anchors: Anchors, person: PersonInput, llmOnly: boolean): AsyncGenerator<AgentEventPayload, Candidate[]> {
  const started = run.deps.now().getTime();
  const { startYear, endYear } = anchors.formativeWindow;
  yield {
    type: "phase",
    phase: "propose",
    status: "started",
    message: llmOnly ? "Brainstorming from the language model alone…" : `Imagining the songs, films and faces of ${startYear}-${endYear}…`,
  };
  const out = await callLlm(
    run,
    proposeCandidatesPrompt,
    {
      anchors,
      maxPerDomain: run.deps.config.agent.maxCandidatesPerDomain,
      domains: TASTE_DOMAINS.map((domain) => ({ domain, qlooTypes: [...TASTE_DOMAIN_QLOO_TYPES[domain]] })),
      caregiverLanguage: person.caregiverLanguage,
    },
    true,
  );
  const candidates = toCandidates(out, run, anchors);
  for (const text of out.notes) {
    const t = clip(text, 400);
    if (t) yield { type: "note", phase: "propose", text: t };
  }
  for (const candidate of candidates) yield { type: "candidate", candidate };
  run.stats.candidates += candidates.length;
  const domains = [...new Set(candidates.map((c) => c.domain.replace("_", " ")))].join(", ");
  yield {
    type: "phase",
    phase: "propose",
    status: "completed",
    message: clip(`${candidates.length} ideas${domains ? ` across ${domains}` : ""}${llmOnly ? " (unverified)" : ""}.`, 400)!,
    durationMs: run.deps.now().getTime() - started,
    counts: { proposed: candidates.length },
  };
  return candidates;
}
