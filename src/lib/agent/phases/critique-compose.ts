/**
 * CRITIQUE (LLM judges era, locale, sensitivities, duplicates) and COMPOSE
 * (LLM writes the timed session). Code decides provenance, attaches
 * entities, enforces limits and makes durations add up.
 */
import type { AgentEventPayload, Anchors, PersonInput, SessionMode, SessionPlan, SessionStep } from "@/lib/domain/types";
import { SessionPlan as SessionPlanSchema, SessionStep as SessionStepSchema } from "@/lib/domain/types";
import { PortError } from "@/lib/ports";
import { composeSessionPrompt, critiqueItemsPrompt, culturalCheckPrompt } from "@/lib/prompts";
import type { ComposeMaterial, ModelStep } from "@/lib/prompts/compose-session";
import { DISCLAIMER_EN } from "@/lib/prompts/compose-session";
import type { CulturalCheckItem } from "@/lib/prompts/cultural-check";

import type { Material, Run } from "@/lib/agent/run";
import { callLlm } from "@/lib/agent/run";
import { clip, isNonWesternOrigin, normalizeDurations } from "@/lib/agent/util";

/** Domain schema limit on steps per plan. */
export const PLAN_MAX_STEPS = 20;

/**
 * F2: cultural-mismatch gate for non-Western personas. The Qloo live probe
 * showed that seeds like Oum Kalthoum / Faten Hamama expand to Hollywood or US
 * political entities. For non-Western origin we ask the LLM to classify each
 * qloo-affinity material as cultural_match | cultural_mismatch | unclear, and
 * reject the mismatches with kind=wrong_locale (the closest frozen rejection
 * kind; the reason text names the extrapolation).
 */
async function* culturalMismatchGate(
  run: Run,
  anchors: Anchors,
  person: PersonInput,
  materials: Material[],
): AsyncGenerator<AgentEventPayload, Set<string>> {
  const rejected = new Set<string>();
  if (!isNonWesternOrigin(anchors, person.sessionLanguage)) return rejected;
  const indexed = materials.map((m, i) => ({ ref: materialAlias(i), m })).filter(({ m }) => m.source === "qloo-affinity");
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
        },
      };
    }
  } catch (error) {
    run.ctx.logger.warn({ phase: "critique", err: error instanceof Error ? error.name : typeof error }, "cultural-check failed; skipping gate");
  }
  return rejected;
}

export async function* critiquePhase(run: Run, anchors: Anchors, person: PersonInput, materials: Material[]): AsyncGenerator<AgentEventPayload, Material[]> {
  const started = run.deps.now().getTime();
  yield { type: "phase", phase: "critique", status: "started", message: "Double-checking dates, places and anything that could upset them…" };
  const culturallyRejected = yield* culturalMismatchGate(run, anchors, person, materials);
  const forCritique = materials.filter((m) => !culturallyRejected.has(m.ref));
  const out = await callLlm(
    run,
    critiqueItemsPrompt,
    {
      anchors,
      caregiverLanguage: person.caregiverLanguage,
      items: forCritique.map((m, i) => ({
        ref: materialAlias(i),
        label: m.label,
        domain: m.domain,
        year: m.year,
        bornYear: m.bornYear,
        description: clip(m.description, 200),
        source: m.source,
      })),
    },
    true,
  );
  const byRef = new Map(forCritique.map((m, i) => [materialAlias(i), m]));
  const rejected = new Set<string>(culturallyRejected);
  for (const verdict of out.verdicts) {
    const material = byRef.get(verdict.ref);
    if (!material || verdict.keep || verdict.kind === "none" || rejected.has(material.ref)) continue;
    rejected.add(material.ref);
    run.stats.rejected++;
    yield {
      type: "rejected",
      item: {
        label: clip(material.label, 200)!,
        reason: clip(verdict.reason, 400) ?? "Does not fit this person.",
        kind: verdict.kind,
        phase: "critique",
        domain: material.domain,
        refId: material.ref,
      },
    };
  }
  for (const text of out.notes) {
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
  };
}

/** Build a domain step from a model step. Provenance is decided here: an attached verified entity means qloo-grounded. */
export function toStep(run: Run, model: ModelStep, material: Material | undefined, order: number, sameLanguage: boolean, grounded: boolean): SessionStep | undefined {
  const prompt = clip(model.prompt, 600);
  if (!prompt) return undefined;
  const entity = grounded ? material?.entity : undefined;
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
    provenance: entity ? "qloo-grounded" : "llm-only",
  });
  return parsed.success ? parsed.data : undefined;
}

export const sameLanguage = (a: string, b: string) => a.toLowerCase().split("-")[0] === b.toLowerCase().split("-")[0];

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
  const maxSteps = Math.min(run.deps.config.agent.maxSessionSteps, PLAN_MAX_STEPS);
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
      disclaimerEnglish: DISCLAIMER_EN,
      materials: kept.map((m, i) => toComposeMaterial(m, kept, materialAlias(i))),
    },
    true,
  );

  const byRef = new Map(kept.map((m, i) => [materialAlias(i), m]));
  const same = sameLanguage(lang, person.caregiverLanguage);
  const draft: SessionStep[] = [];
  for (const model of out.steps) {
    if (draft.length >= maxSteps) break;
    // A step built on something critique rejected never reaches the plan.
    if (model.materialRef && rejectedRefs.has(model.materialRef)) continue;
    const step = toStep(run, model, byRef.get(model.materialRef), draft.length, same, mode === "grounded");
    if (step) draft.push(step);
  }
  if (draft.length === 0) throw new PortError("llm", "invalid_response", "The composed session had no usable steps", false);
  const minutes = normalizeDurations(draft.map((s) => s.durationMin), person.sessionMinutes);
  const steps = draft.map((s, i) => ({ ...s, durationMin: minutes[i] }));
  for (const step of steps) yield { type: "step", step };
  run.stats.steps += steps.length;

  const plan = SessionPlanSchema.parse({
    id: run.deps.newId("plan"),
    title: clip(out.title, 160) ?? "A reminiscence session",
    language: lang,
    caregiverLanguage: person.caregiverLanguage,
    steps,
    totalMinutes: minutes.reduce((a, b) => a + b, 0),
    mode,
    disclaimer: clip(out.disclaimer, 600) ?? DISCLAIMER_EN,
    generatedAt: run.deps.now().toISOString(),
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
