/**
 * Deterministic mock LLM. Returns hand-authored, schema-valid outputs per
 * prompt id: persona fixtures for the three demo personas, and for custom
 * input a generic response built only from structured fields (birth year,
 * birth place, languages). It never interprets the notes. Every output is
 * validated against `request.schema`.
 */
import type { Anchors } from "@/lib/domain/types";
import { PERSONAS } from "@/lib/personas";
import type { CachePort } from "@/lib/ports/cache";
import type { CallContext } from "@/lib/ports/common";
import { PortError } from "@/lib/ports/common";
import type { LlmPort, LlmRequest, LlmResult } from "@/lib/ports/llm";
import type { ComposeMaterial, ComposeSessionInput, ComposeSessionOutput, ModelStep } from "@/lib/prompts/compose-session";
import type { CritiqueItemsInput, CritiqueItemsOutput } from "@/lib/prompts/critique-items";
import type { MatchEntityInput, MatchEntityOutput } from "@/lib/prompts/match-entity";
import type { ParseAnchorsInput, ParseAnchorsOutput } from "@/lib/prompts/parse-anchors";
import type { ProposeCandidatesInput, ProposeCandidatesOutput } from "@/lib/prompts/propose-candidates";
import type { ReplanSessionInput, ReplanSessionOutput, ReplanStepSummary } from "@/lib/prompts/replan-session";

import { llmCacheKey } from "@/lib/adapters/llm/ai-sdk";
import { GENERIC_CANDIDATES, GENERIC_TEXT, GENERIC_YEAR_TOLERANCE, genericLang } from "@/lib/adapters/llm/fixtures/generic";
import type { PersonaFixture, PersonaSlug, StepTemplate } from "@/lib/adapters/llm/fixtures/personas";
import { PERSONA_FIXTURES } from "@/lib/adapters/llm/fixtures/personas";

const squash = (s: string) => s.trim().split(/\s+/u).join(" ");
/** Mock-only loose key for looking up fixtures by label: accent-free letters and digits, no leading "the". */
const looseKey = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/^the\s+/u, "")
    .replace(/[^\p{L}\p{N}]/gu, "");

const sameLang = (a: string, b: string) => a.toLowerCase().split("-")[0] === b.toLowerCase().split("-")[0];

function personaByNotes(notes: string): PersonaFixture | undefined {
  const persona = PERSONAS.find((p) => squash(p.input.notes) === squash(notes));
  return persona ? PERSONA_FIXTURES[persona.slug] : undefined;
}

function personaByAnchors(anchors: Anchors | undefined): PersonaFixture | undefined {
  if (!anchors) return undefined;
  return (Object.keys(PERSONA_FIXTURES) as PersonaSlug[]).map((s) => PERSONA_FIXTURES[s]).find((f) => f.parse.summary === anchors.summary);
}

function lookup<T>(record: Record<string, T>, label: string): T | undefined {
  if (record[label]) return record[label];
  const key = looseKey(label);
  const hit = Object.keys(record).find((k) => looseKey(k) === key);
  return hit ? record[hit] : undefined;
}

function languageName(tag: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

// ---------------------------------------------------------------------------
// Per-prompt responders
// ---------------------------------------------------------------------------

function parseAnchors(input: ParseAnchorsInput): ParseAnchorsOutput {
  const persona = personaByNotes(input.notes);
  if (persona) return persona.parse;
  const birthYear = input.birthYear ?? input.currentYear - 80;
  const tags = [...new Set([input.sessionLanguage, input.caregiverLanguage])];
  return {
    birthYear,
    birthYearSource: input.birthYear ? "stated" : "inferred",
    places: input.birthPlace ? [{ name: input.birthPlace, countryCode: "", role: "birthplace", fromYear: birthYear, toYear: 0 }] : [],
    languages: tags.map((tag) => ({ tag, name: languageName(tag) })),
    loves: [],
    sensitivities: [],
    occupation: "",
    culturalBackground: "",
    summary: `Person born in ${birthYear}${input.birthPlace ? ` in ${input.birthPlace}` : ""}. Demo mode: the free-text notes were not interpreted.`,
    privateNames: [],
    notes: ["Demo mode: only the birth year, birthplace and languages were used, not the free-text notes."],
  };
}

function proposeCandidates(input: ProposeCandidatesInput): ProposeCandidatesOutput {
  const persona = personaByAnchors(input.anchors);
  if (persona) return persona.propose;
  const { startYear, endYear } = input.anchors.formativeWindow;
  const mid = (startYear + endYear) / 2;
  const inWindow = GENERIC_CANDIDATES.filter((c) => c.year >= startYear - GENERIC_YEAR_TOLERANCE && c.year <= endYear + GENERIC_YEAR_TOLERANCE);
  const nearest = [...GENERIC_CANDIDATES].sort((a, b) => Math.abs(a.year - mid) - Math.abs(b.year - mid) || a.name.localeCompare(b.name));
  const picked = inWindow.length >= 4 ? inWindow : [...inWindow, ...nearest.filter((c) => !inWindow.includes(c))].slice(0, 4);
  return {
    candidates: [
      ...picked.map((c) => ({ ...c, rationale: `Widely popular around ${c.year}, during the formative years.` })),
      { domain: "food", name: "A favourite family dish", qlooType: "none", year: 0, rationale: "Ask the family which dish was a ritual at home." },
    ],
    notes: [`Demo mode: internationally known names from ${startYear}-${endYear}.`],
  };
}

function matchEntity(input: MatchEntityInput): MatchEntityOutput {
  const want = looseKey(input.candidate.name);
  const hit = input.results.find((r) => {
    if (r.type !== input.candidate.qlooType) return false;
    const got = looseKey(r.name);
    return got === want || (Math.min(got.length, want.length) >= 4 && (got.includes(want) || want.includes(got)));
  });
  return hit
    ? { matchIndex: hit.index, confidence: "high", reason: "Same entity; only the spelling differs." }
    : { matchIndex: -1, confidence: "low", reason: "No result is clearly the same entity." };
}

function critiqueItems(input: CritiqueItemsInput): CritiqueItemsOutput {
  const persona = personaByAnchors(input.anchors);
  const { startYear, endYear } = input.anchors.formativeWindow;
  const seen = new Map<string, string>();
  const verdicts = input.items.map((item): CritiqueItemsOutput["verdicts"][number] => {
    const fixed = persona ? lookup(persona.critique, item.label) : undefined;
    const key = looseKey(item.label);
    const duplicateOf = seen.get(key);
    seen.set(key, item.label);
    if (fixed) return { ref: item.ref, keep: false, kind: fixed.kind, reason: fixed.reason };
    if (duplicateOf) return { ref: item.ref, keep: false, kind: "duplicate", reason: `Same as ${duplicateOf}, already in the list.` };
    if (item.year && item.year > endYear + GENERIC_YEAR_TOLERANCE) {
      return { ref: item.ref, keep: false, kind: "anachronism", reason: `From ${item.year}, after the formative years (${startYear}-${endYear}).` };
    }
    if (item.bornYear && item.bornYear > input.anchors.birthYear + 12) {
      return { ref: item.ref, keep: false, kind: "anachronism", reason: `Born in ${item.bornYear}: too young to be a star of ${startYear}-${endYear}.` };
    }
    return { ref: item.ref, keep: true, kind: "none", reason: "Fits the era, the places and the notes." };
  });
  const dropped = verdicts.filter((v) => !v.keep).length;
  return { verdicts, notes: [dropped ? `Removed ${dropped} item(s) that do not fit.` : "Everything fits the era and the notes."] };
}

const DOMAIN_KIND: Record<string, "listen" | "look" | "talk" | "taste"> = { music: "listen", sport: "talk", food: "taste" };

function genericStep(material: Pick<ComposeMaterial, "label" | "domain" | "ref">, sessionLanguage: string, caregiverLanguage: string, who: string): ModelStep {
  const kind = DOMAIN_KIND[material.domain] ?? "look";
  const s = GENERIC_TEXT[genericLang(sessionLanguage)][kind];
  const c = GENERIC_TEXT[genericLang(caregiverLanguage)][kind];
  const fill = (t: string) => t.replaceAll("{name}", material.label).replaceAll("{who}", who);
  return {
    kind,
    title: fill(c.title),
    materialRef: material.ref,
    prompt: fill(s.prompt),
    promptTranslation: sameLang(sessionLanguage, caregiverLanguage) ? "" : fill(c.prompt),
    followUps: [],
    caregiverTip: c.tip,
    durationMin: 3,
    mediaHint: kind === "listen" || kind === "look" ? `Search '${material.label}'` : "",
  };
}

function fromTemplate(t: Omit<StepTemplate, "kind" | "minutes">, kind: ModelStep["kind"], minutes: number, ref: string): ModelStep {
  return { kind, title: t.title, materialRef: ref, prompt: t.prompt, promptTranslation: t.translation, followUps: t.followUps, caregiverTip: t.tip, durationMin: minutes, mediaHint: t.mediaHint };
}

function bookend(kind: "opening" | "closing" | "calm", persona: PersonaFixture | undefined, input: { sessionLanguage: string; caregiverLanguage: string }, who: string): ModelStep {
  const stepKind = kind === "calm" ? "listen" : kind;
  if (persona) return kind === "calm" ? fromTemplate(persona.calm, "listen", persona.calm.minutes, "") : fromTemplate(persona[kind], stepKind, 2, "");
  const s = GENERIC_TEXT[genericLang(input.sessionLanguage)][kind];
  const c = GENERIC_TEXT[genericLang(input.caregiverLanguage)][kind];
  const fill = (t: string) => t.replaceAll("{who}", who);
  return {
    kind: stepKind, title: c.title, materialRef: "", prompt: fill(s.prompt),
    promptTranslation: sameLang(input.sessionLanguage, input.caregiverLanguage) ? "" : fill(c.prompt),
    followUps: [], caregiverTip: c.tip, durationMin: kind === "calm" ? 3 : 2, mediaHint: "",
  };
}

const SOURCE_RANK: Record<ComposeMaterial["source"], number> = { "qloo-verified": 0, "llm-idea": 1, "qloo-affinity": 2 };
const DISCLAIMERS: Record<string, string> = {
  it: "Rekindle suggerisce attività di reminiscenza. Non è un consiglio medico né una terapia. Seguite la persona, fermatevi se sembra a disagio e chiedete al team di cura per tutto ciò che riguarda la salute.",
  fr: "Rekindle propose des activités de réminiscence. Ce n'est ni un avis médical ni une thérapie. Suivez la personne, arrêtez si elle semble mal à l'aise et demandez à l'équipe soignante pour toute question de santé.",
};

function composeSession(input: ComposeSessionInput): ComposeSessionOutput {
  const persona = personaByAnchors(input.anchors);
  const who = input.displayName ? ` ${input.displayName}` : "";
  const slots = Math.max(1, input.maxSteps - 2);
  const chosen: ComposeMaterial[] = [];
  for (const label of persona?.planOrder ?? []) {
    const m = input.materials.find((x) => looseKey(x.label) === looseKey(label));
    if (m && !chosen.includes(m)) chosen.push(m);
  }
  const rest = input.materials.filter((m) => !chosen.includes(m)).sort((a, b) => SOURCE_RANK[a.source] - SOURCE_RANK[b.source]);
  for (const m of rest) {
    if (chosen.length >= slots) break;
    if (m.source === "qloo-affinity" && chosen.filter((x) => x.source === "qloo-affinity").length >= 2) continue;
    chosen.push(m);
  }
  const body = chosen.slice(0, slots).map((m) => {
    const t = persona ? lookup(persona.steps, m.label) : undefined;
    return t ? fromTemplate(t, t.kind, t.minutes, m.ref) : genericStep(m, input.sessionLanguage, input.caregiverLanguage, who);
  });
  const lang = genericLang(input.sessionLanguage);
  return {
    title: persona?.title ?? { en: "A gentle trip back in time", it: "Un dolce viaggio nel tempo", fr: "Un doux voyage dans le temps" }[lang],
    disclaimer: DISCLAIMERS[input.caregiverLanguage.toLowerCase().split("-")[0]] ?? input.disclaimerEnglish,
    steps: [bookend("opening", persona, input, who), ...body, bookend("closing", persona, input, who)],
  };
}

const KEEP_PLACEHOLDER: ModelStep = { kind: "talk", title: "", materialRef: "", prompt: "", promptTranslation: "", followUps: [], caregiverTip: "", durationMin: 1, mediaHint: "" };

function replanSession(input: ReplanSessionInput): ReplanSessionOutput {
  const persona = personaByAnchors(input.anchors);
  const keep = (s: ReplanStepSummary) => ({ keepStepId: s.id, step: KEEP_PLACEHOLDER });
  const isClosing = (s: ReplanStepSummary) => s.kind === "closing";
  const upcoming = [...input.upcoming];
  const reacted = input.reactedStep;
  const removed: ReplanSessionOutput["removed"] = [];
  let first: { keepStepId: string; step: ModelStep } | undefined;
  let message: string;
  let note: string;

  if (input.reaction === "upset") {
    const risky = upcoming.find((s) => !isClosing(s) && ((s.domain && s.domain === reacted.domain) || s.kind === "talk"));
    if (risky) {
      removed.push({ stepId: risky.id, kind: "emotional_risk", reason: `'${risky.title}' could stir up the same feelings; skipped for now.` });
      upcoming.splice(upcoming.indexOf(risky), 1);
    }
    first = { keepStepId: "", step: bookend("calm", persona, input, "") };
    message = "Next up: a calm, familiar pause.";
    note = `They seemed upset during '${reacted.title}'. Slowing down with something soothing and familiar.`;
  } else if (input.reaction === "lit_up") {
    const fresh = input.newMaterials[0];
    if (fresh) {
      const t = persona ? lookup(persona.steps, fresh.label) : undefined;
      first = { keepStepId: "", step: t ? fromTemplate(t, t.kind, t.minutes, fresh.ref) : genericStep(fresh, input.sessionLanguage, input.caregiverLanguage, "") };
      const total = upcoming.reduce((n, s) => n + s.durationMin, first.step.durationMin);
      const droppable = [...upcoming].reverse().find((s) => !isClosing(s));
      if (total > input.minutesRemaining && droppable) {
        removed.push({ stepId: droppable.id, kind: "low_relevance", reason: "Making room for more of what they enjoyed." });
        upcoming.splice(upcoming.indexOf(droppable), 1);
      }
      message = `More of what lit them up: ${fresh.label} next.`;
    } else {
      const same = upcoming.find((s) => !isClosing(s) && s.domain === reacted.domain);
      if (same) upcoming.unshift(...upcoming.splice(upcoming.indexOf(same), 1));
      message = "Keeping that thread going.";
    }
    note = `They lit up at '${reacted.title}': leaning into that thread.`;
  } else {
    const different = upcoming.find((s) => !isClosing(s) && s.kind !== reacted.kind);
    if (different) upcoming.unshift(...upcoming.splice(upcoming.indexOf(different), 1));
    message = different ? `Trying something different next: ${different.title}.` : "Carrying on gently.";
    note = `No reaction to '${reacted.title}': changing the kind of activity.`;
  }

  return { message, notes: [note], upcoming: [...(first ? [first] : []), ...upcoming.map(keep)].slice(0, Math.max(1, input.maxUpcoming)), removed };
}

const RESPONDERS: Record<string, (input: never) => unknown> = {
  "parse-anchors": parseAnchors,
  "propose-candidates": proposeCandidates,
  "match-entity": matchEntity,
  "critique-items": critiqueItems,
  "compose-session": composeSession,
  "replan-session": replanSession,
};

export class MockLlm implements LlmPort {
  readonly mode = "mock" as const;
  readonly provider = "mock";
  readonly model = "mock-llm";

  constructor(private readonly options: { cache?: CachePort; cacheTtlSeconds?: number; latencyMs?: number } = {}) {}

  async generateObject<T>(request: LlmRequest<T>, ctx: CallContext): Promise<LlmResult<T>> {
    const started = Date.now();
    const { cache, cacheTtlSeconds = 0 } = this.options;
    const key = llmCacheKey(this.provider, this.model, request as LlmRequest<unknown>);
    const hit = cache ? await cache.get<unknown>(key) : undefined;
    const cachedParse = hit === undefined ? undefined : request.schema.safeParse(hit);
    if (cachedParse?.success) {
      return { object: cachedParse.data, cached: true, provider: this.provider, model: this.model, latencyMs: Date.now() - started };
    }

    const responder = RESPONDERS[request.promptId];
    if (!responder) throw new PortError("llm", "bad_request", `The mock LLM has no fixture for prompt '${request.promptId}'`, false);
    if (this.options.latencyMs) await new Promise((r) => setTimeout(r, this.options.latencyMs));
    if (ctx.signal?.aborted) throw new PortError("llm", "timeout", "The language model call was cancelled", false);
    const parsed = request.schema.safeParse(responder(request.input as never));
    if (!parsed.success) throw new PortError("llm", "invalid_response", `Mock output for '${request.promptId}' does not match the schema`, false);
    if (cache) await cache.set(key, parsed.data, { ttlSeconds: cacheTtlSeconds, sensitive: request.sensitive });
    ctx.logger.debug({ port: "llm", promptId: request.promptId, version: request.version, source: "mock" }, "llm call");
    return { object: parsed.data, cached: false, provider: this.provider, model: this.model, latencyMs: Date.now() - started };
  }
}
