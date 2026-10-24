/**
 * CRITIQUE (LLM judges era, locale, sensitivities, duplicates) and COMPOSE
 * (LLM writes the timed session). Code decides provenance, attaches
 * entities, enforces limits and makes durations add up.
 */
import type { AgentEventPayload, Anchors, LifePhaseLabel, PersonInput, SessionMode, SessionPlan, SessionStep, StepKind, TasteDomain } from "@/lib/domain/types";
import { LifePhaseLabel as LifePhaseLabelSchema, SessionPlan as SessionPlanSchema, SessionStep as SessionStepSchema } from "@/lib/domain/types";
import { PortError } from "@/lib/ports";
import { composeSessionPrompt, critiqueItemsPrompt, culturalCheckPrompt } from "@/lib/prompts";
import type { ComposeMaterial, ComposeStep, ModelStep } from "@/lib/prompts/compose-session";
import { DISCLAIMER_EN } from "@/lib/prompts/compose-session";
import type { CRITIQUE_KINDS, CritiqueItem } from "@/lib/prompts/critique-items";
import { schema as critiqueSchema } from "@/lib/prompts/critique-items";
import type { CulturalCheckItem } from "@/lib/prompts/cultural-check";

import { phaseForYear } from "@/lib/agent/phases/parse-propose";
import type { Material, Run } from "@/lib/agent/run";
import { callLlm } from "@/lib/agent/run";
import type { CoverageStep, StageMinimum } from "@/lib/agent/stage-policy";
import { computeCoverageGaps, countDomainSteps, stageMinimums } from "@/lib/agent/stage-policy";
import { clip, isNonWesternOrigin, normalizeDurations } from "@/lib/agent/util";

/** Domain schema limit on steps per plan. */
export const PLAN_MAX_STEPS = 20;

/**
 * Per-stage soft caps on step count. Reflects the reminiscence evidence
 * base: mild-dementia sessions can span the fuller arc (Cochrane 2018,
 * Säkämö 2014); mid-stage attention narrows (IRISS Scotland); late-stage
 * benefits from fewer, shorter, sensory anchors (NICE NG97 wellbeing
 * bracket, not cognition). Absent stage defaults to the early-stage cap.
 */
export function stageMaxSteps(stage: PersonInput["stage"], configMax: number): number {
  const capped = Math.min(configMax, PLAN_MAX_STEPS);
  if (stage === "mid") return Math.min(capped, 6);
  if (stage === "late") return Math.min(capped, 5);
  return Math.min(capped, 8);
}

/**
 * F2: cultural-mismatch gate for non-Western personas. The Qloo live probe
 * showed that seeds like Oum Kalthoum / Faten Hamama expand to Hollywood or
 * US political entities, and the LLM's own propose step over-reaches to
 * mainstream Western figures (worldwide bands, Hollywood classics, US
 * political figures) for the same cultural blind spot. For non-Western
 * origin we ask the LLM to
 * classify each groundable material (qloo-affinity from expand plus
 * qloo-verified from the LLM's proposals) as cultural_match |
 * cultural_mismatch | unclear, and reject the mismatches with
 * kind=wrong_locale (the closest frozen rejection kind; the reason text
 * names the extrapolation). LLM-only candidates that failed verify are not
 * checked here: critique-items handles those with its sensitivity and era
 * rules.
 */
async function* culturalMismatchGate(
  run: Run,
  anchors: Anchors,
  person: PersonInput,
  materials: Material[],
): AsyncGenerator<AgentEventPayload, Set<string>> {
  const rejected = new Set<string>();
  if (!isNonWesternOrigin(anchors, person.sessionLanguage)) return rejected;
  const indexed = materials
    .map((m, i) => ({ ref: materialAlias(i), m }))
    .filter(({ m }) => m.source === "qloo-affinity" || m.source === "qloo-verified");
  if (indexed.length === 0) return rejected;

  const items: CulturalCheckItem[] = indexed.map(({ ref, m }) => ({
    ref,
    name: m.label,
    domain: m.domain,
    description: clip(m.description, 200),
    seeds: m.entity?.seedQlooIds
      ?.map((id) => materials.find((x) => x.entity?.qlooId === id)?.label)
      .filter((n): n is string => Boolean(n)),
  }));
  const primary = anchors.places[0];
  try {
    const out = await callLlm(
      run,
      culturalCheckPrompt,
      {
        origin: {
          primaryCountryCode: primary?.countryCode,
          primaryPlace: primary?.name,
          culturalBackground: anchors.culturalBackground,
          languages: anchors.languages.map((l) => l.tag),
        },
        items,
      },
      true,
    );
    for (const verdict of out.verdicts) {
      if (verdict.verdict !== "cultural_mismatch") continue;
      const entry = indexed.find((x) => x.ref === verdict.ref);
      if (!entry) continue;
      rejected.add(entry.m.ref);
      run.stats.rejected++;
      yield {
        type: "rejected",
        item: {
          label: clip(entry.m.label, 200)!,
          reason: clip(`cultural_mismatch: ${verdict.reason}`, 400) ?? "Cross-cultural extrapolation.",
          kind: "wrong_locale",
          phase: "critique",
          domain: entry.m.domain,
          refId: entry.m.ref,
          catchSource: "cultural-check",
        },
      };
    }
  } catch (error) {
    run.ctx.logger.warn({ phase: "critique", err: error instanceof Error ? error.name : typeof error }, "cultural-check failed; skipping gate");
  }
  return rejected;
}

/** One validated critique judgment for one input item. */
type CritiqueKind = (typeof CRITIQUE_KINDS)[number];
export type CritiqueJudgment = { ref: string; keep: boolean; kind: CritiqueKind; reason: string };

const VerdictSchema = critiqueSchema.shape.verdicts.element;

/**
 * One batched structured LLM call that judges every item. Returns exactly one
 * judgment per input ref: a verdict that is missing or malformed in the model
 * output, or a failed call, degrades to keep (over-including beats crashing a
 * plan). Aborts (deadline, client disconnect) still propagate.
 */
export async function critiqueBatch(
  run: Run,
  anchors: Anchors,
  person: PersonInput,
  items: CritiqueItem[],
): Promise<{ judgments: Map<string, CritiqueJudgment>; notes: string[] }> {
  const judgments = new Map<string, CritiqueJudgment>();
  const keep = (ref: string): CritiqueJudgment => ({ ref, keep: true, kind: "none", reason: "" });
  let notes: string[] = [];
  if (items.length > 0) {
    try {
      const out = await callLlm(run, critiqueItemsPrompt, { anchors, caregiverLanguage: person.caregiverLanguage, items }, true);
      const wanted = new Set(items.map((i) => i.ref));
      const verdicts: unknown[] = Array.isArray(out?.verdicts) ? out.verdicts : [];
      for (const raw of verdicts) {
        const parsed = VerdictSchema.safeParse(raw);
        if (!parsed.success || !wanted.has(parsed.data.ref) || judgments.has(parsed.data.ref)) continue;
        const v = parsed.data;
        judgments.set(v.ref, v.keep || v.kind === "none" ? keep(v.ref) : v);
      }
      notes = Array.isArray(out?.notes) ? out.notes.filter((n): n is string => typeof n === "string") : [];
    } catch (error) {
      if (run.ctx.signal?.aborted) throw error;
      run.ctx.logger.warn({ phase: "critique", err: error instanceof Error ? error.name : typeof error }, "critique call failed; keeping all items");
    }
  }
  let defaulted = 0;
  for (const item of items) {
    if (!judgments.has(item.ref)) {
      judgments.set(item.ref, keep(item.ref));
      defaulted++;
    }
  }
  if (defaulted > 0) run.ctx.logger.warn({ phase: "critique", defaulted, total: items.length }, "critique verdicts missing or malformed; defaulted to keep");
  return { judgments, notes };
}

export async function* critiquePhase(run: Run, anchors: Anchors, person: PersonInput, materials: Material[]): AsyncGenerator<AgentEventPayload, Material[]> {
  const started = run.deps.now().getTime();
  yield { type: "phase", phase: "critique", status: "started", message: "Double-checking dates, places and anything that could upset them…" };
  // The era/sensitivity batch and the cultural gate are independent: run them
  // concurrently (the batch also sees gate rejects, which are then skipped).
  const batch = critiqueBatch(
    run,
    anchors,
    person,
    materials.map((m, i) => ({
      ref: materialAlias(i),
      label: m.label,
      domain: m.domain,
      year: m.year,
      bornYear: m.bornYear,
      description: clip(m.description, 200),
      source: m.source,
    })),
  );
  batch.catch(() => undefined);
  const culturallyRejected = yield* culturalMismatchGate(run, anchors, person, materials);
  const { judgments, notes } = await batch;
  const rejected = new Set<string>(culturallyRejected);
  for (const [i, material] of materials.entries()) {
    const verdict = judgments.get(materialAlias(i));
    if (!verdict || verdict.keep || rejected.has(material.ref)) continue;
    rejected.add(material.ref);
    run.stats.rejected++;
    yield {
      type: "rejected",
      item: {
        label: clip(material.label, 200)!,
        reason: clip(verdict.reason, 400) ?? "Does not fit this person.",
        kind: verdict.kind as Exclude<CritiqueKind, "none">,
        phase: "critique",
        domain: material.domain,
        refId: material.ref,
        catchSource: "critique-llm",
      },
    };
  }
  for (const text of notes) {
    const t = clip(text, 400);
    if (t) yield { type: "note", phase: "critique", text: t };
  }
  const kept = materials.filter((m) => !rejected.has(m.ref));
  yield {
    type: "phase",
    phase: "critique",
    status: "completed",
    message: rejected.size ? `Removed ${rejected.size} item(s) that do not fit; ${kept.length} kept.` : "No issues found.",
    durationMs: run.deps.now().getTime() - started,
    counts: { kept: kept.length, rejected: rejected.size },
  };
  return kept;
}

/**
 * Refs shown to the LLM are per-call aliases by position ("m1", "m2", ...), not the
 * generated ids, so equal inputs give equal prompts and the input-keyed cache can hit.
 */
export const materialAlias = (index: number, prefix = "m") => `${prefix}${index + 1}`;

export function toComposeMaterial(m: Material, all: Material[], ref: string): ComposeMaterial {
  const seedNames = m.entity?.seedQlooIds?.map((id) => all.find((x) => x.entity?.qlooId === id)?.label).filter((n): n is string => Boolean(n));
  return {
    ref,
    label: m.label,
    domain: m.domain,
    year: m.year,
    description: clip(m.description, 200),
    source: m.source,
    ...(seedNames?.length ? { becauseOf: seedNames } : {}),
    ...(m.lifePhase ? { lifePhase: m.lifePhase } : {}),
  };
}

/** Build a domain step from a model step. Provenance is decided here: an attached verified entity means qloo-grounded. */
export function toStep(run: Run, anchors: Anchors, model: ModelStep & { fallbackReason?: ComposeStep["fallbackReason"] }, material: Material | undefined, order: number, sameLanguage: boolean, grounded: boolean): SessionStep | undefined {
  const prompt = clip(model.prompt, 600);
  if (!prompt) return undefined;
  const entity = grounded ? material?.entity : undefined;
  // Phase precedence: a material-attached phase wins over what the model
  // emitted (the material's phase was derived from the candidate / propose
  // call, closer to the source of truth). Fall back to the model's choice,
  // then to undefined. 'none' sentinels mean "no phase" and are dropped.
  const modelPhase = model.lifePhase && model.lifePhase !== "none" ? LifePhaseLabelSchema.safeParse(model.lifePhase) : undefined;
  let lifePhase: LifePhaseLabel | undefined = material?.lifePhase ?? (modelPhase?.success ? modelPhase.data : undefined);
  // Server-side guarantee: every body step carries a lifePhase when the person
  // has phases defined. If the LLM left it as 'none' and no material phase was
  // attached, prefer the phase whose window contains the material's year;
  // else fall back to the formative window's midpoint phase. Opening and
  // closing are left phase-less on purpose.
  const isBody = model.kind !== "opening" && model.kind !== "closing";
  const phases = anchors.lifePhases;
  if (!lifePhase && isBody && phases && phases.length > 0) {
    const materialYear = material?.year;
    const fw = anchors.formativeWindow;
    const midYear = Math.round((fw.startYear + fw.endYear) / 2);
    lifePhase =
      (materialYear !== undefined ? phaseForYear(phases, materialYear) : undefined) ??
      phaseForYear(phases, midYear);
  }
  const parsed = SessionStepSchema.safeParse({
    id: run.deps.newId("s"),
    order,
    kind: model.kind,
    title: clip(model.title, 120) ?? clip(material?.label, 120) ?? model.kind,
    entity,
    prompt,
    promptTranslation: sameLanguage ? undefined : clip(model.promptTranslation, 600),
    followUps: model.followUps.map((f) => clip(f, 300)).filter((f): f is string => Boolean(f)).slice(0, 4),
    caregiverTip: clip(model.caregiverTip, 300),
    durationMin: Math.min(30, Math.max(1, Math.round(model.durationMin) || 1)),
    mediaUrl: entity?.imageUrl,
    mediaHint: clip(model.mediaHint, 200),
    lifePhase,
    provenance: entity ? "qloo-grounded" : "llm-only",
    // Only body steps can be fallbacks; "none" (the strict-schema sentinel) maps
    // to absent. "min_enforcement" is a code-only marker set by the deterministic
    // enforcement pass, never trusted from the model.
    fallbackReason:
      isBody && model.fallbackReason && model.fallbackReason !== "none" && model.fallbackReason !== "min_enforcement"
        ? model.fallbackReason
        : undefined,
  });
  return parsed.success ? parsed.data : undefined;
}

export const sameLanguage = (a: string, b: string) => a.toLowerCase().split("-")[0] === b.toLowerCase().split("-")[0];

/**
 * Build a deterministic step on a verified material to meet a stage-required
 * domain minimum. No LLM call: the prompt and tip are short, present-tense,
 * and name the entity directly. The step inherits the replaced step's slot
 * (order, duration, lifePhase) so the plan budget stays untouched. Marked
 * fallbackReason "min_enforcement" so the trace can account for the swap.
 */
function buildEnforcedStep(
  run: Run,
  anchors: Anchors,
  kind: StepKind,
  material: Material,
  replaced: SessionStep,
  grounded: boolean,
): SessionStep | undefined {
  if (!material.entity) return undefined;
  const label = clip(material.label, 120) ?? material.entity.name;
  const prompt = kind === "move" ? `Let us move gently to ${label}.` : `Let us listen together to ${label}.`;
  const tip = `${label} is a verified ${material.domain} anchor added to meet this stage's ${material.domain} minimum.`;
  const mediaHint = kind === "listen" || kind === "move" ? `Search '${label}' on YouTube` : "";
  const phases = anchors.lifePhases;
  const fw = anchors.formativeWindow;
  const midYear = Math.round((fw.startYear + fw.endYear) / 2);
  const lifePhase: LifePhaseLabel | undefined =
    material.lifePhase ??
    replaced.lifePhase ??
    (phases && phases.length > 0
      ? phaseForYear(phases, material.year ?? midYear)
      : undefined);
  const entity = grounded ? material.entity : undefined;
  const parsed = SessionStepSchema.safeParse({
    id: run.deps.newId("s"),
    order: replaced.order,
    kind,
    title: clip(label, 120)!,
    entity,
    prompt,
    followUps: [],
    caregiverTip: clip(tip, 300),
    durationMin: replaced.durationMin,
    mediaUrl: entity?.imageUrl,
    mediaHint: clip(mediaHint, 200),
    lifePhase,
    provenance: entity ? "qloo-grounded" : "llm-only",
    fallbackReason: "min_enforcement",
  });
  return parsed.success ? parsed.data : undefined;
}

/**
 * A body step is swappable when: it is not an opening or closing; it does not
 * already contribute to the minimum we want to raise (replacing it would net
 * zero); and removing it does not drop any other stage minimum below its
 * floor.
 */
function isSwappable(
  cov: CoverageStep,
  allCov: readonly CoverageStep[],
  mins: readonly StageMinimum[],
  target: StageMinimum,
): boolean {
  if (cov.kind === "opening" || cov.kind === "closing") return false;
  const contributesToTarget =
    target.stepKinds.includes(cov.kind) &&
    (cov.materialDomain === undefined || cov.materialDomain === target.domain);
  if (contributesToTarget) return false;
  for (const other of mins) {
    if (other.domain === target.domain) continue;
    const contributesToOther =
      other.stepKinds.includes(cov.kind) &&
      (cov.materialDomain === undefined || cov.materialDomain === other.domain);
    if (!contributesToOther) continue;
    const otherCount = countDomainSteps(allCov, other);
    if (otherCount - 1 < other.minSteps) return false;
  }
  return true;
}

export interface EnforcementResult {
  steps: SessionStep[];
  coverageSteps: CoverageStep[];
  enforced: number;
  bySwappedDomain: Partial<Record<TasteDomain, number>>;
}

/**
 * Deterministic post-compose minimum enforcement. When the composer undershot
 * a stage-required domain and unused verified entities of that domain remain,
 * swap flex body steps for additional steps on those entities. Keep opening,
 * closing, the step count and (per-slot) the duration budget untouched. When
 * no viable swap exists, leave the plan alone: the honest coverageGaps row
 * surfaces the shortfall.
 */
export function enforceStageMinimums(
  run: Run,
  anchors: Anchors,
  person: PersonInput,
  draft: readonly SessionStep[],
  coverageSteps: readonly CoverageStep[],
  usedRefs: ReadonlySet<string>,
  materials: readonly Material[],
  grounded: boolean,
): EnforcementResult {
  const mins = stageMinimums(person.stage);
  const bySwappedDomain: Partial<Record<TasteDomain, number>> = {};
  const steps = [...draft];
  const cov = [...coverageSteps];
  if (mins.length === 0) return { steps, coverageSteps: cov, enforced: 0, bySwappedDomain };

  // Unused, verified materials grouped by domain, in deterministic input order.
  const unusedByDomain = new Map<TasteDomain, Material[]>();
  for (const m of materials) {
    if (usedRefs.has(m.ref)) continue;
    if (!m.entity) continue;
    const bucket = unusedByDomain.get(m.domain);
    if (bucket) bucket.push(m);
    else unusedByDomain.set(m.domain, [m]);
  }

  let enforced = 0;
  for (const min of mins) {
    const pool = unusedByDomain.get(min.domain) ?? [];
    while (pool.length > 0) {
      const have = countDomainSteps(cov, min);
      if (have >= min.minSteps) break;
      const idx = cov.findIndex((c) => isSwappable(c, cov, mins, min));
      if (idx < 0) break;
      const material = pool.shift()!;
      const kind: StepKind = min.stepKinds[0] ?? "listen";
      const next = buildEnforcedStep(run, anchors, kind, material, steps[idx], grounded);
      if (!next) break;
      steps[idx] = next;
      cov[idx] = { kind: next.kind, materialDomain: material.domain };
      enforced++;
      bySwappedDomain[min.domain] = (bySwappedDomain[min.domain] ?? 0) + 1;
    }
  }
  return { steps, coverageSteps: cov, enforced, bySwappedDomain };
}

export async function* composePhase(
  run: Run,
  anchors: Anchors,
  person: PersonInput,
  mode: SessionMode,
  kept: Material[],
  rejectedRefs: Set<string>,
): AsyncGenerator<AgentEventPayload, SessionPlan> {
  const started = run.deps.now().getTime();
  const lang = person.sessionLanguage;
  yield { type: "phase", phase: "compose", status: "started", message: `Arranging a gentle ${person.sessionMinutes}-minute session…` };
  const maxSteps = stageMaxSteps(person.stage, run.deps.config.agent.maxSessionSteps);
  const out = await callLlm(
    run,
    composeSessionPrompt,
    {
      displayName: person.displayName,
      anchors,
      sessionLanguage: lang,
      caregiverLanguage: person.caregiverLanguage,
      sessionMinutes: person.sessionMinutes,
      maxSteps,
      stage: person.stage,
      stageMinimums: stageMinimums(person.stage),
      disclaimerEnglish: DISCLAIMER_EN,
      materials: kept.map((m, i) => toComposeMaterial(m, kept, materialAlias(i))),
    },
    true,
  );

  const byRef = new Map(kept.map((m, i) => [materialAlias(i), m]));
  const same = sameLanguage(lang, person.caregiverLanguage);
  const draft: SessionStep[] = [];
  const coverageSteps: CoverageStep[] = [];
  const usedRefs = new Set<string>();
  for (const model of out.steps) {
    if (draft.length >= maxSteps) break;
    // A step built on something critique rejected never reaches the plan.
    if (model.materialRef && rejectedRefs.has(model.materialRef)) continue;
    const material = byRef.get(model.materialRef);
    const step = toStep(run, anchors, model, material, draft.length, same, mode === "grounded");
    if (step) {
      draft.push(step);
      coverageSteps.push({ kind: step.kind, materialDomain: material?.domain });
      if (material) usedRefs.add(material.ref);
    }
  }
  if (draft.length === 0) throw new PortError("llm", "invalid_response", "The composed session had no usable steps", false);
  // Deterministic post-compose minimum enforcement: swap flex body steps for
  // unused verified entities of a stage-required domain the composer undershot.
  const enforcement = enforceStageMinimums(run, anchors, person, draft, coverageSteps, usedRefs, kept, mode === "grounded");
  if (enforcement.enforced > 0) {
    run.ctx.logger.info(
      { phase: "compose", enforced: enforcement.enforced, byDomain: enforcement.bySwappedDomain },
      "coverageEnforced",
    );
  }
  const minutes = normalizeDurations(enforcement.steps.map((s) => s.durationMin), person.sessionMinutes);
  // Late-stage pace guarantee: NICE NG97 wellbeing bracket at late-stage calls
  // for short, calm anchors. Local qwen3:8b and hosted models that drift into
  // 3-4 minute bodies get clipped here. Shape-reshape only (a numeric cap on a
  // numeric field); semantic prompt judgments stay in the LLM via the compose
  // system prompt's late-stage worked example.
  const steps = enforcement.steps.map((s, i) => {
    const isBody = s.kind !== "opening" && s.kind !== "closing";
    const clipped = person.stage === "late" && isBody ? Math.min(minutes[i], 2) : minutes[i];
    return { ...s, durationMin: clipped };
  });
  for (const step of steps) yield { type: "step", step };
  run.stats.steps += steps.length;
  // Truthful coverage: derived from the structured kind and material domain of what was
  // actually composed, after enforcement, never from the model's own claim.
  const coverageGaps = computeCoverageGaps({
    stage: person.stage,
    steps: enforcement.coverageSteps,
    availableDomains: kept.map((m) => m.domain),
    unverifiedDomains: run.unverifiedDomains,
  });
  if (coverageGaps.length > 0) {
    run.ctx.logger.warn({ phase: "compose", gaps: coverageGaps.map((g) => `${g.domain}:${g.actualCount}/${g.requiredCount}:${g.reason}`) }, "stage minimum not met");
  }

  const plan = SessionPlanSchema.parse({
    id: run.deps.newId("plan"),
    title: clip(out.title, 160) ?? "A reminiscence session",
    language: lang,
    caregiverLanguage: person.caregiverLanguage,
    steps,
    totalMinutes: steps.reduce((a, s) => a + s.durationMin, 0),
    mode,
    disclaimer: clip(out.disclaimer, 600) ?? DISCLAIMER_EN,
    generatedAt: run.deps.now().toISOString(),
    ...(coverageGaps.length > 0 ? { coverageGaps } : {}),
    meta: {
      llmProvider: run.deps.llm.provider,
      llmModel: run.deps.llm.model,
      qlooMode: mode === "llm-only" ? "unused" : run.deps.taste.mode,
      promptVersions: { ...run.promptVersions },
      revision: 0,
    },
  });
  yield { type: "plan", plan };
  yield {
    type: "phase",
    phase: "compose",
    status: "completed",
    message: `Your session is ready: ${steps.length} steps, ${plan.totalMinutes} minutes.`,
    durationMs: run.deps.now().getTime() - started,
    counts: { steps: steps.length, grounded: steps.filter((s) => s.provenance === "qloo-grounded").length },
  };
  return plan;
}
