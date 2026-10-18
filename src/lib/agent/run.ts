/**
 * Per-request run state shared by the session and replan loops: guarded
 * taste port, deadline signals, counters, LLM call wrapper, entity mapping
 * and error-to-event mapping. Depends only on ports and domain types.
 */
import { z } from "zod";

import type { AgentEventPayload, AgentPhase, Candidate, ErrorCode, TasteDomain, VerifiedEntity } from "@/lib/domain/types";
import { VerifiedEntity as VerifiedEntitySchema, Year } from "@/lib/domain/types";
import type { AgentDeps, CallContext, PromptDefinition, TasteEntity, TastePort, TasteResponse } from "@/lib/ports";
import { buildLlmRequest, PortError, withPersonalDataGuard } from "@/lib/ports";

import { clip } from "@/lib/agent/util";

/** Share of the deadline that Qloo calls may use; the rest is kept for critique and compose. */
export const QLOO_DEADLINE_SHARE = 0.6;

export interface RunStats {
  candidates: number;
  verified: number;
  rejected: number;
  steps: number;
  llmCalls: number;
  qlooCalls: number;
  cacheHits: number;
}

/** Something a step can be built on: a verified entity or an unverified LLM idea. */
export interface Material {
  ref: string;
  label: string;
  domain: TasteDomain;
  year?: number;
  bornYear?: number;
  description?: string;
  source: "qloo-verified" | "qloo-affinity" | "llm-idea";
  entity?: VerifiedEntity;
  candidate?: Candidate;
}

export interface Run {
  deps: AgentDeps;
  /** Context for LLM calls: request signal plus the hard deadline. */
  ctx: CallContext;
  /** Context for Qloo calls: also aborts at the Qloo share of the deadline. */
  qlooCtx: CallContext;
  /** The taste port wrapped with the personal-data guard (HARD RULE 2). */
  taste: TastePort;
  stats: RunStats;
  promptVersions: Record<string, string>;
  startedAt: number;
  /** Set once Qloo failed; later Qloo work is skipped. */
  qlooDown: boolean;
  deadlineHit: () => boolean;
  dispose: () => void;
}

export function createRun(deps: AgentDeps, ctx: CallContext, forbiddenTerms: readonly string[]): Run {
  const deadline = new AbortController();
  const qlooDeadline = new AbortController();
  const timers = [
    setTimeout(() => deadline.abort(), deps.config.agent.deadlineMs),
    setTimeout(() => qlooDeadline.abort(), Math.floor(deps.config.agent.deadlineMs * QLOO_DEADLINE_SHARE)),
  ];
  const signals = ctx.signal ? [ctx.signal, deadline.signal] : [deadline.signal];
  const signal = AbortSignal.any(signals);
  return {
    deps,
    ctx: { ...ctx, signal },
    qlooCtx: { ...ctx, signal: AbortSignal.any([...signals, qlooDeadline.signal]) },
    taste: withPersonalDataGuard(deps.taste, forbiddenTerms),
    stats: { candidates: 0, verified: 0, rejected: 0, steps: 0, llmCalls: 0, qlooCalls: 0, cacheHits: 0 },
    promptVersions: {},
    startedAt: deps.now().getTime(),
    qlooDown: false,
    deadlineHit: () => deadline.signal.aborted,
    dispose: () => timers.forEach(clearTimeout),
  };
}

/** One structured LLM call through the port, counted and recorded in the plan meta. */
export async function callLlm<I, O>(run: Run, prompt: PromptDefinition<I, O>, input: I, sensitive: boolean): Promise<O> {
  run.stats.llmCalls++;
  run.promptVersions[prompt.id] = prompt.version;
  const result = await run.deps.llm.generateObject(buildLlmRequest(prompt, input, { sensitive }), run.ctx);
  if (result.cached) run.stats.cacheHits++;
  return result.object;
}

/** Call the guarded taste port; a synchronous guard throw becomes a rejection. */
export function callTaste<T>(run: Run, fn: (taste: TastePort, ctx: CallContext) => Promise<TasteResponse<T>>): Promise<TasteResponse<T>> {
  if (run.qlooDown) return Promise.reject(new PortError("taste", "unavailable", "Qloo was marked unavailable earlier in this run", false));
  return Promise.resolve().then(() => fn(run.taste, run.qlooCtx));
}

/** The provenance event for one Qloo request; counts it. */
export function qlooCallEvent(run: Run, phase: AgentPhase, response: TasteResponse<unknown>): AgentEventPayload {
  run.stats.qlooCalls++;
  if (response.request.cached) run.stats.cacheHits++;
  return { type: "qloo_call", phase, call: response.request };
}

const Url = z.url({ protocol: /^https?$/ });
const unit = (v: number | undefined) => (v !== undefined && v >= 0 && v <= 1 ? v : undefined);

/** Map a port entity into a domain VerifiedEntity (validated, with schema limits applied). */
export function toVerifiedEntity(
  run: Run,
  entity: TasteEntity,
  domain: TasteDomain,
  origin: { provenance: "llm-proposed-qloo-verified"; candidateId: string } | { provenance: "qloo-affinity"; seedQlooIds: string[] },
): VerifiedEntity {
  const releaseYear = Year.safeParse(entity.releaseYear);
  const imageUrl = Url.safeParse(entity.imageUrl);
  return VerifiedEntitySchema.parse({
    id: run.deps.newId("ve"),
    qlooId: entity.qlooId.slice(0, 128),
    name: clip(entity.name, 200) ?? entity.qlooId,
    domain,
    qlooType: entity.type,
    affinity: unit(entity.affinity),
    popularity: unit(entity.popularity),
    releaseYear: releaseYear.success ? releaseYear.data : undefined,
    imageUrl: imageUrl.success ? imageUrl.data : undefined,
    description: clip(entity.description, 600),
    ...(origin.provenance === "qloo-affinity"
      ? { provenance: origin.provenance, seedQlooIds: origin.seedQlooIds.slice(0, 10) }
      : { provenance: origin.provenance, candidateId: origin.candidateId }),
  });
}

export function bornYearOf(entity: TasteEntity): number | undefined {
  const year = entity.dateOfBirth ? Number(entity.dateOfBirth.slice(0, 4)) : NaN;
  return Number.isInteger(year) ? year : undefined;
}

export function errorFromQloo(error: PortError, phase: AgentPhase): AgentEventPayload {
  const code: ErrorCode = error.code === "rate_limited" ? "rate_limited" : "qloo_unavailable";
  return {
    type: "error",
    code,
    phase,
    recoverable: true,
    message: "Qloo could not be reached, so the rest of this plan uses the language model's ideas only (marked LLM-only).",
  };
}

/** Map an unexpected failure to a fatal error event with a safe message. */
export function fatalError(run: Run, error: unknown, phase: AgentPhase | undefined): AgentEventPayload {
  let code: ErrorCode = "internal";
  let message = "Something went wrong while planning. Please try again.";
  if (run.deadlineHit() || run.ctx.signal?.aborted) {
    code = "deadline_exceeded";
    message = "Planning took too long and was stopped. Please try again.";
  } else if (error instanceof PortError && error.port === "llm") {
    code = error.code === "rate_limited" ? "rate_limited" : "llm_unavailable";
    message = "The language model is unavailable right now, so no plan could be made. Please try again in a moment.";
  } else if (error instanceof PortError && error.port === "taste") {
    code = error.code === "rate_limited" ? "rate_limited" : "qloo_unavailable";
    message = "Qloo is unavailable right now. Please try again, or use LLM-only mode.";
  }
  run.ctx.logger.error({ phase, code, err: error instanceof Error ? error.name : typeof error }, "agent run failed");
  return { type: "error", code, message, recoverable: false, ...(phase ? { phase } : {}) };
}

export function doneEvent(run: Run): AgentEventPayload {
  return { type: "done", traceId: run.ctx.traceId, durationMs: Math.max(0, run.deps.now().getTime() - run.startedAt), stats: { ...run.stats } };
}
