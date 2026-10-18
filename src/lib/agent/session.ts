/**
 * The 6-phase session loop: PARSE -> PROPOSE -> VERIFY -> EXPAND -> CRITIQUE
 * -> COMPOSE, streamed as stamped AgentEvents (docs/api.md). `done` is always
 * the last event, also after a fatal error.
 */
import { createEventStamper } from "@/lib/domain/ndjson";
import type { AgentEvent, AgentEventPayload, AgentPhase, SessionRequest } from "@/lib/domain/types";
import type { AgentDeps, CallContext } from "@/lib/ports";
import { personalTermsFromDisplayName, withPersonalDataGuard } from "@/lib/ports";

import { composePhase, critiquePhase } from "@/lib/agent/phases/critique-compose";
import { parsePhase, proposePhase } from "@/lib/agent/phases/parse-propose";
import { expandPhase, ideaMaterial, verifyPhase } from "@/lib/agent/phases/verify-expand";
import type { Material, Run } from "@/lib/agent/run";
import { createRun, doneEvent, fatalError } from "@/lib/agent/run";

/** Stamp a payload stream and guarantee that `done` comes last. */
export async function* stamped(
  run: Run,
  body: () => AsyncGenerator<AgentEventPayload, unknown>,
): AsyncGenerator<AgentEvent> {
  const stamp = createEventStamper(() => run.deps.now().getTime());
  let phase: AgentPhase | undefined;
  try {
    try {
      for await (const payload of body()) {
        if (payload.type === "phase") phase = payload.phase;
        yield stamp(payload);
      }
    } catch (error) {
      yield stamp(fatalError(run, error, phase));
    }
    run.ctx.logger.info({ ...run.stats, durationMs: run.deps.now().getTime() - run.startedAt }, "agent run done");
    yield stamp(doneEvent(run));
  } finally {
    run.dispose();
  }
}

export function runSession(deps: AgentDeps, request: SessionRequest, ctx: CallContext): AsyncGenerator<AgentEvent> {
  const { person, mode } = request;
  const run = createRun(deps, ctx, personalTermsFromDisplayName(person.displayName));
  const llmOnly = mode === "llm-only";

  return stamped(run, async function* () {
    const { anchors, privateNames } = yield* parsePhase(run, person);
    // Private names found in the notes (family, friends) are also blocked from Qloo.
    if (privateNames.length) {
      const terms = [...personalTermsFromDisplayName(person.displayName), ...privateNames.flatMap((n) => personalTermsFromDisplayName(n))];
      run.taste = withPersonalDataGuard(deps.taste, terms);
    }

    const candidates = yield* proposePhase(run, anchors, person, llmOnly);

    let materials: Material[];
    if (llmOnly) {
      yield { type: "phase", phase: "verify", status: "skipped", message: "LLM-only mode: nothing is checked against Qloo." };
      yield { type: "phase", phase: "expand", status: "skipped", message: "LLM-only mode: no cross-domain discoveries." };
      materials = candidates.map(ideaMaterial);
    } else {
      materials = yield* verifyPhase(run, candidates);
      const discovered = yield* expandPhase(run, anchors, materials);
      materials = [...materials, ...discovered];
    }

    const kept = yield* critiquePhase(run, anchors, person, materials);
    const keptRefs = new Set(kept.map((m) => m.ref));
    const rejectedRefs = new Set(materials.filter((m) => !keptRefs.has(m.ref)).map((m) => m.ref));
    yield* composePhase(run, anchors, person, mode, kept, rejectedRefs);
  });
}
