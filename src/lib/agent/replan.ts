/**
 * Stateless replan (docs/api.md): adapt the upcoming steps of a running
 * session to the person's reaction. Past steps never change; kept steps keep
 * their ids; the plan keeps its id and gets `meta.revision + 1`.
 */
import type { AgentEvent, AgentEventPayload, QlooInsightsType, ReplanRequest, SessionPlan, SessionStep } from "@/lib/domain/types";
import { QLOO_INSIGHTS_TYPES, SessionPlan as SessionPlanSchema } from "@/lib/domain/types";
import type { AgentDeps, CallContext } from "@/lib/ports";
import { replanSessionPrompt } from "@/lib/prompts";
import type { ReplanStepSummary } from "@/lib/prompts/replan-session";

import { materialAlias, sameLanguage, toComposeMaterial, toStep, PLAN_MAX_STEPS } from "@/lib/agent/phases/critique-compose";
import { entityMaterial } from "@/lib/agent/phases/verify-expand";
import type { Material, Run } from "@/lib/agent/run";
import { callLlm, callTaste, createRun, errorFromQloo, qlooCallEvent, toVerifiedEntity } from "@/lib/agent/run";
import { stamped } from "@/lib/agent/session";
import { ageBucket, clip, DOMAIN_OF_TYPE, eraFilter, isTasteOutage, normalizeName, primaryPlace } from "@/lib/agent/util";

/** New Qloo-affinity materials offered to the replan after a "lit up" reaction. */
export const REPLAN_NEW_MATERIALS = 2;

/**
 * Replan-start narration keyed by reaction. Caregiver-language inner voice,
 * matching the recorded demo copy in sample-events (`sample.replanStarted`).
 */
const STARTED: Record<ReplanRequest["reaction"], string> = {
  lit_up: "Leaning into this thread…",
  neutral: "Trying something different…",
  upset: "They seemed upset. Slowing down with something calm and familiar…",
};

const summarize = (s: SessionStep): ReplanStepSummary => ({
  id: s.id,
  title: s.title,
  kind: s.kind,
  domain: s.entity?.domain,
  entityName: s.entity?.name,
  durationMin: s.durationMin,
});

async function* affinityFrom(run: Run, request: ReplanRequest, reacted: SessionStep): AsyncGenerator<AgentEventPayload, Material[]> {
  const entity = reacted.entity;
  if (request.reaction !== "lit_up" || request.plan.mode !== "grounded" || !entity) return [];
  if (!QLOO_INSIGHTS_TYPES.includes(entity.qlooType as QlooInsightsType)) return [];
  const type = entity.qlooType as QlooInsightsType;
  const inPlan = request.plan.steps.flatMap((s) => (s.entity ? [s.entity] : []));
  try {
    const res = await callTaste(run, (taste, ctx) =>
      taste.insights(
        {
          type,
          seedEntityIds: [entity.qlooId],
          locationQuery: primaryPlace(request.anchors),
          ageBucket: ageBucket(request.anchors.birthYear, run.deps.now().getUTCFullYear()),
          era: eraFilter(request.anchors),
          excludeEntityIds: [...new Set(inPlan.map((e) => e.qlooId))].slice(0, 50),
          trendBias: "off",
          take: REPLAN_NEW_MATERIALS * 2,
        },
        ctx,
      ),
    );
    yield qlooCallEvent(run, "replan", res);
    const names = new Set(inPlan.map((e) => normalizeName(e.name)));
    const fresh = res.items.filter((e) => !names.has(normalizeName(e.name))).slice(0, REPLAN_NEW_MATERIALS);
    const materials: Material[] = [];
    for (const raw of fresh) {
      const verified = toVerifiedEntity(run, raw, DOMAIN_OF_TYPE[type] ?? entity.domain, { provenance: "qloo-affinity", seedQlooIds: [entity.qlooId] });
      run.stats.verified++;
      yield { type: "verified", entity: verified };
      materials.push(entityMaterial(verified, raw));
    }
    return materials;
  } catch (error) {
    if (isTasteOutage(error)) yield errorFromQloo(error, "replan");
    return [];
  }
}

export function runReplan(deps: AgentDeps, request: ReplanRequest, ctx: CallContext): AsyncGenerator<AgentEvent> {
  // A replan request carries no display name; the guard still wraps every Qloo call.
  const run = createRun(deps, ctx, []);
  const { plan, anchors } = request;

  return stamped(run, async function* () {
    const started = run.deps.now().getTime();
    yield { type: "phase", phase: "replan", status: "started", message: STARTED[request.reaction] };
    yield { type: "note", phase: "replan", text: STARTED[request.reaction] };
    const reacted = plan.steps.find((s) => s.id === request.stepId);
    if (!reacted) {
      yield { type: "error", code: "invalid_input", phase: "replan", recoverable: false, message: "That step is not part of this plan." };
      return;
    }
    const steps = [...plan.steps].sort((a, b) => a.order - b.order);
    const done = steps.filter((s) => s.order <= reacted.order);
    const upcoming = steps.filter((s) => s.order > reacted.order);
    const finish = (newSteps: SessionStep[]): SessionPlan =>
      SessionPlanSchema.parse({
        ...plan,
        steps: newSteps.map((s, order) => ({ ...s, order })),
        totalMinutes: Math.min(120, Math.max(1, newSteps.reduce((n, s) => n + s.durationMin, 0))),
        generatedAt: run.deps.now().toISOString(),
        meta: { ...plan.meta, promptVersions: { ...plan.meta.promptVersions, ...run.promptVersions }, revision: plan.meta.revision + 1 },
      });

    if (upcoming.length === 0) {
      yield { type: "note", phase: "replan", text: "That was the last step: there is nothing left to adapt." };
      yield { type: "plan", plan: finish(steps) };
      yield { type: "phase", phase: "replan", status: "completed", message: "Nothing to change.", durationMs: run.deps.now().getTime() - started };
      return;
    }

    const newMaterials = yield* affinityFrom(run, request, reacted);
    const titles = new Map(plan.steps.map((s) => [s.id, s.title]));
    const doneMinutes = done.reduce((n, s) => n + s.durationMin, 0);
    // Room for upcoming steps, keeping one slot for the closing step that is re-appended below.
    const room = PLAN_MAX_STEPS - done.length;
    const maxUpcoming = Math.max(1, Math.min(room - 1, upcoming.length + 2));
    const out = await callLlm(
      run,
      replanSessionPrompt,
      {
        anchors,
        sessionLanguage: plan.language,
        caregiverLanguage: plan.caregiverLanguage,
        reaction: request.reaction,
        reactedStep: summarize(reacted),
        history: request.history.map((h) => ({ stepTitle: titles.get(h.stepId) ?? h.stepId, reaction: h.reaction })),
        note: request.note,
        done: done.map(summarize),
        upcoming: upcoming.map(summarize),
        newMaterials: newMaterials.map((m, i) => toComposeMaterial(m, newMaterials, materialAlias(i, "n"))),
        minutesRemaining: Math.max(1, plan.totalMinutes - doneMinutes),
        maxUpcoming,
      },
      true,
    );
    for (const text of out.notes) {
      const t = clip(text, 400);
      if (t) yield { type: "note", phase: "replan", text: t };
    }

    const byId = new Map(upcoming.map((s) => [s.id, s]));
    const byRef = new Map(newMaterials.map((m, i) => [materialAlias(i, "n"), m]));
    const same = sameLanguage(plan.language, plan.caregiverLanguage);
    const next: SessionStep[] = [];
    const created = new Set<string>();
    for (const item of out.upcoming) {
      if (next.length >= maxUpcoming) break;
      const kept = item.keepStepId ? byId.get(item.keepStepId) : undefined;
      if (item.keepStepId && kept && !next.includes(kept)) next.push(kept);
      else if (!item.keepStepId) {
        const step = toStep(run, item.step, byRef.get(item.step.materialRef), 0, same, plan.mode === "grounded");
        if (step) {
          next.push(step);
          created.add(step.id);
        }
      }
    }
    const closing = upcoming.find((s) => s.kind === "closing");
    if (closing && !next.some((s) => s.kind === "closing")) next.push(closing);
    if (next.length === 0) next.push(...upcoming.slice(0, room));

    // Never exceed the plan's step limit: drop the last non-closing steps that do not fit.
    const trimmed: SessionStep[] = [];
    while (next.length > Math.max(1, room)) {
      const index = next.findLastIndex((s) => s.kind !== "closing");
      const [dropped] = next.splice(index >= 0 ? index : next.length - 1, 1);
      created.delete(dropped.id);
      trimmed.push(dropped);
    }

    const reasons = new Map(out.removed.map((r) => [r.stepId, r]));
    for (const step of upcoming.filter((s) => !next.includes(s) && !trimmed.includes(s))) {
      const r = reasons.get(step.id);
      run.stats.rejected++;
      yield {
        type: "rejected",
        item: {
          label: step.title,
          // Steps the model dropped without saying why are treated as making room, not as risky.
          reason: clip(r?.reason, 400) ?? "Removed to make room for what comes next.",
          kind: r?.kind ?? "low_relevance",
          phase: "replan",
          domain: step.entity?.domain,
          refId: step.id,
        },
      };
    }
    for (const step of trimmed) {
      run.stats.rejected++;
      yield {
        type: "rejected",
        item: {
          label: step.title,
          reason: "No room left in this session.",
          kind: "low_relevance",
          phase: "replan",
          domain: step.entity?.domain,
          refId: step.id,
        },
      };
    }

    const newPlan = finish([...done, ...next]);
    for (const step of newPlan.steps.filter((s) => created.has(s.id))) yield { type: "step", step };
    run.stats.steps += created.size;
    yield { type: "plan", plan: newPlan };
    yield {
      type: "phase",
      phase: "replan",
      status: "completed",
      message: clip(out.message, 400) ?? "The rest of the session is adapted.",
      durationMs: run.deps.now().getTime() - started,
      counts: { added: created.size, removed: upcoming.filter((s) => !next.includes(s)).length + trimmed.filter((s) => !upcoming.includes(s)).length },
    };
  });
}
