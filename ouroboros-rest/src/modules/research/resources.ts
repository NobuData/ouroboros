/**
 * The research estimator's published shapes — what `POST /research/estimates` answers, and what
 * the service hands CM.6 ([#625](https://github.com/NobuData/ouroboros/issues/625)) and CM.1
 * ([#620](https://github.com/NobuData/ouroboros/issues/620)).
 *
 * [#622](https://github.com/NobuData/ouroboros/issues/622). The mapping from rows and the pure
 * estimate to these shapes lives here, once, so the endpoint and the store path cannot describe
 * one estimate two ways.
 */

import type { InvestigationDepth, InvestigationEstimateOutcome } from "../db/schema";
import type { Range, ScopeEstimate, ToolOperations } from "./estimate";
import { renderEstimateLabel } from "./estimate";

/** The task kind the researcher's alias is resolved for — routing's `route.task("research")`. */
export const RESEARCH_TASK_KIND = "research";

/**
 * The researcher the composer's pill names — the alias routing resolved `research` to.
 *
 * The first **kept** hop of the resolved chain: the alias that will actually run if the run
 * starts now. When the primary is down that is the fallback, and the pill says so rather than
 * naming an alias that will not answer.
 */
export interface ResearcherResource {
  /** Always `research`. */
  readonly taskKind: string;
  /** The route's tag — `research-primary`. */
  readonly routeTag: string;
  /** The alias — `researcher-long-ctx`. What the pill prints. */
  readonly alias: string;
  /** What the alias means — the raw model id (decision M1: the only place it appears). */
  readonly modelId: string;
}

/** One estimate, as the composer receives it. */
export interface ScopeEstimateResource {
  /** The depth estimated. */
  readonly depth: InvestigationDepth;
  /** The tools estimated — the request's, or the kind's playbook defaults. */
  readonly tools: readonly string[];
  /**
   * The researcher, or null when routing has nothing to run: no `research` route in this
   * workspace, or a resolution with no kept hop. Null makes the estimate unpriced, too.
   */
  readonly researcher: ResearcherResource | null;
  /** Which estimator calibration computed it. */
  readonly calibrationVersion: number;
  /** The operation budget — total and per tool. */
  readonly operations: { readonly total: number; readonly byTool: readonly ToolOperations[] };
  /** Planned model calls through the researcher alias. */
  readonly synthesisCalls: Range;
  /** Citable sources expected. Always present. */
  readonly sources: Range;
  /** Expected spend in cents — or null when the researcher is unpriced, and then no cost anywhere. */
  readonly costCents: Range | null;
  /** The composer's line, verbatim — `est. 40–60 sources · ~$6`. No `$` when `costCents` is null. */
  readonly label: string;
}

/** An investigation's estimate set beside what it actually used — one calibration record. */
export interface EstimateOutcomeResource {
  /** The investigation. */
  readonly investigationId: string;
  /** The calibration its estimate was computed under. */
  readonly calibrationVersion: number;
  readonly depth: InvestigationDepth;
  readonly tools: readonly string[];
  /** The alias that ran it, or null when none was recorded. */
  readonly alias: string | null;
  /** The estimate. */
  readonly estimated: { readonly sources: Range; readonly costCents: Range | null };
  /** The actuals. */
  readonly actual: { readonly sources: number; readonly spendCents: number | null };
  /** Whether the actual source count fell inside the estimate. */
  readonly sourcesWithinEstimate: boolean;
  /** Whether the actual spend fell inside the cost range; null when either side is unpriced. */
  readonly costWithinEstimate: boolean | null;
  readonly recordedAt: string;
}

/**
 * The published form of an estimate.
 *
 * @param estimate - The pure estimate.
 * @param depth - The depth it was computed for.
 * @param tools - The tools it was computed for.
 * @param researcher - The resolved researcher, or null.
 * @returns The resource, with its label composed.
 */
export function scopeEstimateResource(
  estimate: ScopeEstimate,
  depth: InvestigationDepth,
  tools: readonly string[],
  researcher: ResearcherResource | null,
): ScopeEstimateResource {
  return {
    depth,
    tools: [...tools],
    researcher,
    calibrationVersion: estimate.calibrationVersion,
    operations: estimate.operations,
    synthesisCalls: estimate.synthesisCalls,
    sources: estimate.sources,
    costCents: estimate.costCents,
    label: renderEstimateLabel(estimate),
  };
}

/**
 * The published form of a calibration record.
 *
 * @param row - The `investigation_estimate_outcomes` row.
 * @returns The resource.
 */
export function estimateOutcomeResource(
  row: InvestigationEstimateOutcome,
): EstimateOutcomeResource {
  const cost =
    row.estimated_cost_cents_min === null || row.estimated_cost_cents_max === null
      ? null
      : { min: row.estimated_cost_cents_min, max: row.estimated_cost_cents_max };

  return {
    investigationId: row.investigation_id,
    calibrationVersion: row.calibration_version,
    depth: row.depth,
    tools: row.tools_enabled,
    alias: row.alias,
    estimated: {
      sources: { min: row.estimated_sources_min, max: row.estimated_sources_max },
      costCents: cost,
    },
    actual: { sources: row.actual_sources, spendCents: row.actual_spend_cents },
    sourcesWithinEstimate: row.sources_within_estimate,
    costWithinEstimate: row.cost_within_estimate,
    recordedAt: row.recorded_at.toISOString(),
  };
}
