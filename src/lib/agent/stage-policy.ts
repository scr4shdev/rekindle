/**
 * Stage-minimum domain counts for the COMPOSE phase. Single source of truth:
 * the compose prompt receives these as data (never as magic numbers in prose)
 * and the code uses the same table to report coverage gaps honestly.
 *
 * Only structured fields decide anything here: a step's kind and the domain of
 * the material it is built on. No name matching.
 */
import type { CoverageGap, CoverageReason, DementiaStage, StepKind, TasteDomain } from "@/lib/domain/types";

export interface StageMinimum {
  domain: TasteDomain;
  /** Fewest steps in this domain the plan should contain. */
  minSteps: number;
  /** Step kinds that count toward the minimum (music: listen, move). */
  stepKinds: readonly StepKind[];
}

/** Which step kinds count as a step "in" a domain. Domains absent here have no stage minimum. */
export const DOMAIN_STEP_KINDS: Partial<Record<TasteDomain, readonly StepKind[]>> = {
  music: ["listen", "move"],
};

/**
 * Minimum steps per domain by dementia stage. Music has the strongest evidence
 * base and is the only domain with a stage minimum today. Absent stage means early.
 */
export const STAGE_DOMAIN_MINIMUMS: Record<DementiaStage, Partial<Record<TasteDomain, number>>> = {
  early: { music: 2 },
  mid: { music: 3 },
  late: { music: 1 },
};

export function stageMinimums(stage: DementiaStage | undefined): StageMinimum[] {
  const table = STAGE_DOMAIN_MINIMUMS[stage ?? "early"];
  const out: StageMinimum[] = [];
  for (const [domain, minSteps] of Object.entries(table) as [TasteDomain, number][]) {
    const stepKinds = DOMAIN_STEP_KINDS[domain];
    if (stepKinds && minSteps > 0) out.push({ domain, minSteps, stepKinds });
  }
  return out;
}

/** A composed step reduced to the structured facts coverage needs. */
export interface CoverageStep {
  kind: StepKind;
  /** Domain of the material the step is built on; absent for generic steps and opening/closing. */
  materialDomain?: TasteDomain;
}

/** A step counts toward a domain when its kind fits and any material it uses is in that domain. */
export function countDomainSteps(steps: readonly CoverageStep[], minimum: StageMinimum): number {
  return steps.filter((s) => minimum.stepKinds.includes(s.kind) && (s.materialDomain === undefined || s.materialDomain === minimum.domain)).length;
}

export interface CoverageInput {
  stage: DementiaStage | undefined;
  steps: readonly CoverageStep[];
  /** Domains of the materials that survived critique (any source). */
  availableDomains: readonly TasteDomain[];
  /** Domains where a proposed anchor failed verification (for example Qloo not_found). */
  unverifiedDomains: ReadonlySet<TasteDomain>;
}

/** Every stage minimum the composed steps did not reach, each with an honest reason. */
export function computeCoverageGaps(input: CoverageInput): CoverageGap[] {
  const gaps: CoverageGap[] = [];
  for (const minimum of stageMinimums(input.stage)) {
    const actualCount = countDomainSteps(input.steps, minimum);
    if (actualCount >= minimum.minSteps) continue;
    const viable = input.availableDomains.filter((d) => d === minimum.domain).length;
    const reason: CoverageReason =
      viable === 0 ? "no_viable_alternative" : input.unverifiedDomains.has(minimum.domain) ? "primary_not_verified" : "composer_omitted";
    gaps.push({ domain: minimum.domain, requiredCount: minimum.minSteps, actualCount, reason });
  }
  return gaps;
}
