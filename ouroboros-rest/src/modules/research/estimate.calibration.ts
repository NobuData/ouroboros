/**
 * The estimator's calibration — every constant CM.3's scope and cost estimate is computed from.
 *
 * [#622](https://github.com/NobuData/ouroboros/issues/622), decision **V5**: *scope/cost
 * estimates are computed, never invented*. The composer's `est. 40–60 sources · ~$6` falls out
 * of three things the person chose — a depth preset, a tool selection, and (through routing) the
 * alias that will synthesise — and out of the numbers below, which say how much work each of
 * those choices plans for. Nothing else feeds the estimate, so moving any choice moves it.
 *
 * ---------------------------------------------------------------------------
 * **The chain, in four steps.**
 *
 *   1. *Operation budget* — each enabled tool plans {@link TOOL_OPERATIONS_PER_ROUND} operations
 *      per research round, and a depth preset runs {@link DEPTH_PRESETS}`.rounds` rounds.
 *      Deep dive × [web, competitor, code, tickets, telemetry] is (3+2+2+2+1) × 4 = **40**.
 *   2. *Sources* — an operation yields between {@link SOURCES_PER_OPERATION}`.min` and `.max`
 *      citable sources: 40 operations → **40–60** sources.
 *   3. *Synthesis calls* — one digest call per source read ({@link DIGEST_CALL}) plus the depth's
 *      synthesis passes ({@link SYNTHESIS_CALL} × `synthesisPasses`), priced at the routed
 *      alias's per-token rates. At `$3 · $15` per 1M a digest is 8.25¢ and a pass is 48¢, so
 *      deep dive is 40 × 8.25 + 4 × 48 = **522¢** to 60 × 8.25 + 4 × 48 = **687¢** — `~$6`.
 *   4. *Hosted tool operations* — where a tool's provider charges per operation (#615's provider
 *      configs), each planned operation adds its price to both ends of the range.
 *
 * ---------------------------------------------------------------------------
 * **These are calibration, not truth, and they are versioned.** Every stored estimate records
 * {@link CALIBRATION_VERSION} beside it (V109's `investigations.estimate_calibration_version`),
 * and every finished investigation's estimate is reconciled against its actuals in
 * `investigation_estimate_outcomes`. Re-calibrating is deterministic arithmetic over those rows
 * — the share of actuals inside the range, per depth and tool set, under one version — and a
 * change to any constant here is a new version, so history is never re-graded against numbers
 * it was not estimated with.
 */

import type { InvestigationDepth } from "../db/schema";

/**
 * The calibration these constants are. Bump it whenever any constant in this file changes.
 */
export const CALIBRATION_VERSION = 1;

/** What a depth preset plans for. */
export interface DepthPreset {
  /** Research rounds: each enabled tool runs its per-round operations this many times. */
  readonly rounds: number;
  /** Long synthesis passes over everything gathered — outline, draft, cross-check, brief. */
  readonly synthesisPasses: number;
}

/**
 * The composer's Depth menu. Deeper runs more rounds of every tool and more synthesis passes,
 * so both the source range and the cost range rise from `quick` to `deep_dive`.
 */
export const DEPTH_PRESETS: Readonly<Record<InvestigationDepth, DepthPreset>> = {
  quick: { rounds: 1, synthesisPasses: 1 },
  standard: { rounds: 2, synthesisPasses: 2 },
  deep_dive: { rounds: 4, synthesisPasses: 4 },
};

/**
 * Operations each tool plans per round, by `research_tools` slug.
 *
 *   * `web` — 3: a search and two page reads.
 *   * `competitor`, `code`, `tickets`, `docs` — 2: a query and a follow-up.
 *   * `telemetry` — 1: one window comparison answers a round.
 */
export const TOOL_OPERATIONS_PER_ROUND: Readonly<Record<string, number>> = {
  web: 3,
  competitor: 2,
  code: 2,
  tickets: 2,
  telemetry: 1,
  docs: 2,
};

/**
 * Operations per round for a registered tool this table does not list yet — an adapter that
 * joined `research_tools` after this calibration. One operation is the least a tool that ran
 * at all can have done, and the reconciliation rows are what will say whether it is right.
 */
export const DEFAULT_TOOL_OPERATIONS_PER_ROUND = 1;

/**
 * Citable sources one operation yields, as a ratio `numerator / denominator`, low and high.
 * Integer ratios rather than decimals so the range never depends on float rounding:
 * 40 operations × 1/1 = 40, × 3/2 = 60.
 */
export const SOURCES_PER_OPERATION = {
  min: { numerator: 1, denominator: 1 },
  max: { numerator: 3, denominator: 2 },
} as const;

/** The token shape of one planned model call. */
export interface PlannedCall {
  /** Prompt tokens sent. */
  readonly inputTokens: number;
  /** Completion tokens received. */
  readonly outputTokens: number;
}

/** One digest call per source read: the page or record in, an extract with its claims out. */
export const DIGEST_CALL: PlannedCall = { inputTokens: 20_000, outputTokens: 1_500 };

/** One synthesis pass: the gathered extracts in, a section of the brief out. */
export const SYNTHESIS_CALL: PlannedCall = { inputTokens: 120_000, outputTokens: 8_000 };

/** The token count a per-1M rate is quoted against. */
export const TOKENS_PER_RATE_UNIT = 1_000_000;
