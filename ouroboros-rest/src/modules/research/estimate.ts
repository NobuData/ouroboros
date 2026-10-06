/**
 * The scope and cost estimate, as a pure function — no database, no clock, no routing.
 *
 * [#622](https://github.com/NobuData/ouroboros/issues/622), decision **V5**. Everything that
 * *decides* a number lives here and in `estimate.calibration.ts`; `estimate.service.ts` only
 * reads the inputs (the routed alias's price, the hosted tools' prices) and hands them over. The
 * split is what lets the acceptance figure — deep dive, five tools, `$3 · $15` → `40–60 sources
 * · ~$6` — be asserted exactly, without a database.
 *
 * **The honesty rule is structural.** With no synthesis rates there is no `costCents`, and the
 * label carries no `$`: an unpriced alias is a source range and nothing else, never a `$0` and
 * never a plausible guess. Hosted tool prices alone do not produce a cost either — a figure that
 * left out the model calls would be a smaller number presented as the whole one.
 *
 * **Arithmetic is exact.** Rates arrive as the decimal strings `model_prices` stores (four
 * places), and are carried as integer ten-thousandths of a cent in `bigint`, so `522` is `522`
 * and never `521.9999…` floored to `521`. The low end is floored and the high end is ceiled: a
 * range that rounds outward still contains the arithmetic's answer.
 */

import type { InvestigationDepth } from "../db/schema";
import {
  CALIBRATION_VERSION,
  DEFAULT_TOOL_OPERATIONS_PER_ROUND,
  DEPTH_PRESETS,
  DIGEST_CALL,
  type PlannedCall,
  SOURCES_PER_OPERATION,
  SYNTHESIS_CALL,
  TOKENS_PER_RATE_UNIT,
  TOOL_OPERATIONS_PER_ROUND,
} from "./estimate.calibration";

/** An inclusive integer range. */
export interface Range {
  readonly min: number;
  readonly max: number;
}

/** The routed alias's per-token rates, in cents per 1M tokens, as `model_prices` stores them. */
export interface SynthesisRates {
  /** Input rate — a decimal string such as `"300.0000"`, or a number. */
  readonly inputCentsPer1m: string | number;
  /** Output rate, in the same form. */
  readonly outputCentsPer1m: string | number;
}

/** What one estimate is computed from. */
export interface EstimateInput {
  /** The composer's Depth menu. */
  readonly depth: InvestigationDepth;
  /** The enabled tool slugs — distinct and non-empty. Order is kept in the breakdown. */
  readonly tools: readonly string[];
  /**
   * The synthesis alias's rates, or null when it is unpriced (no price row, or one that is not
   * per-token). Null means **no cost at all** in the result.
   */
  readonly synthesisRates: SynthesisRates | null;
  /**
   * What a hosted provider charges per operation, in cents, by tool slug. A tool absent here
   * costs nothing per operation beyond the model calls. Empty when no hosted provider is
   * configured.
   */
  readonly toolOperationCents: ReadonlyMap<string, number>;
}

/** One tool's share of the operation budget. */
export interface ToolOperations {
  /** The `research_tools` slug. */
  readonly tool: string;
  /** Operations it plans over the whole investigation. */
  readonly operations: number;
  /**
   * Cents a hosted provider charges for them, rounded up — or null when it charges nothing, none
   * is configured, or the synthesis alias is unpriced (then the estimate has no cost anywhere).
   */
  readonly hostedCostCents: number | null;
}

/** The estimate — what the composer prints, and what an investigation stores. */
export interface ScopeEstimate {
  /** Which calibration computed it. */
  readonly calibrationVersion: number;
  /** The operation budget: its total and each tool's share, in the order the tools were given. */
  readonly operations: { readonly total: number; readonly byTool: readonly ToolOperations[] };
  /** Planned model calls through the synthesis alias: one digest per source, plus the passes. */
  readonly synthesisCalls: Range;
  /** Citable sources expected. Always present. */
  readonly sources: Range;
  /** Expected spend in cents, or null when the synthesis alias is unpriced. */
  readonly costCents: Range | null;
}

/** Ten-thousandths of a cent per token-rate unit — the scale `numeric(14, 4)` rates are exact in. */
const RATE_SCALE = 10_000n;

/** The divisor that turns `tokens × scaled rate` into cents. */
const CENT_DIVISOR = BigInt(TOKENS_PER_RATE_UNIT) * RATE_SCALE;

/**
 * Parses a non-negative decimal rate into integer ten-thousandths, exactly.
 *
 * @param value - `"300.0000"`, `"0.25"`, `300` — at most four decimal places.
 * @returns The rate × 10 000, as a `bigint`.
 * @throws {RangeError} When the value is negative, not a decimal, or finer than four places —
 *   which a `model_prices` row cannot hold, so it means the caller passed something else.
 */
export function scaledRate(value: string | number): bigint {
  const text = typeof value === "number" ? String(value) : value.trim();
  const match = /^(\d+)(?:\.(\d{1,4}))?$/.exec(text);

  if (match === null) {
    throw new RangeError(`"${text}" is not a non-negative rate with at most four decimal places`);
  }

  const [, whole, fraction = ""] = match;
  return BigInt(whole) * RATE_SCALE + BigInt(fraction.padEnd(4, "0"));
}

/**
 * Operations one tool plans over a whole investigation at a depth.
 *
 * @param tool - The `research_tools` slug.
 * @param depth - The depth preset.
 * @returns Per-round operations × rounds; an unlisted tool uses the default per-round count.
 */
export function toolOperations(tool: string, depth: InvestigationDepth): number {
  const perRound = TOOL_OPERATIONS_PER_ROUND[tool] ?? DEFAULT_TOOL_OPERATIONS_PER_ROUND;
  return perRound * DEPTH_PRESETS[depth].rounds;
}

/**
 * The source range an operation budget yields.
 *
 * @param operations - The total operation budget.
 * @returns `{min, max}` — floor of the low ratio, ceiling of the high one.
 */
export function sourceRange(operations: number): Range {
  const { min, max } = SOURCES_PER_OPERATION;
  return {
    min: Math.floor((operations * min.numerator) / min.denominator),
    max: Math.ceil((operations * max.numerator) / max.denominator),
  };
}

/**
 * The exact cost of one planned call, in ten-thousandths-of-a-cent × 1M tokens.
 *
 * @param call - The call's token shape.
 * @param input - The scaled input rate.
 * @param output - The scaled output rate.
 * @returns `tokens × scaled rate`, summed — divide by {@link CENT_DIVISOR} for cents.
 */
function scaledCallCost(call: PlannedCall, input: bigint, output: bigint): bigint {
  return BigInt(call.inputTokens) * input + BigInt(call.outputTokens) * output;
}

/**
 * Integer division rounding down, for non-negative operands.
 *
 * @param value - The dividend.
 * @param divisor - The divisor.
 * @returns ⌊value / divisor⌋.
 */
function floorDiv(value: bigint, divisor: bigint): number {
  return Number(value / divisor);
}

/**
 * Integer division rounding up, for non-negative operands.
 *
 * @param value - The dividend.
 * @param divisor - The divisor.
 * @returns ⌈value / divisor⌉.
 */
function ceilDiv(value: bigint, divisor: bigint): number {
  return Number((value + divisor - 1n) / divisor);
}

/**
 * Estimates an investigation's scope and cost.
 *
 * @param input - Depth, tools, the synthesis alias's rates and any hosted tool prices.
 * @returns The estimate. `costCents` is null exactly when `synthesisRates` is.
 * @throws {RangeError} When `tools` is empty or repeats a slug, or a rate is malformed — states
 *   the request validation refuses first, so reaching one here is a caller's mistake.
 */
export function estimateInvestigation(input: EstimateInput): ScopeEstimate {
  const { depth, tools, synthesisRates, toolOperationCents } = input;

  if (tools.length === 0) {
    throw new RangeError("an investigation needs at least one tool to estimate");
  }
  if (new Set(tools).size !== tools.length) {
    throw new RangeError(`the tool selection repeats a slug: ${tools.join(", ")}`);
  }

  const byTool = tools.map((tool) => {
    const operations = toolOperations(tool, depth);
    const perOperation = toolOperationCents.get(tool);
    return {
      tool,
      operations,
      // Scaled exactly like a rate, so a fractional per-operation price stays exact too.
      // Only priced when the model calls are: a hosted tool's price on its own would put a
      // dollar figure into an estimate the honesty rule says has none.
      scaledHosted:
        synthesisRates === null || perOperation === undefined || perOperation === 0
          ? null
          : BigInt(operations) * scaledRate(perOperation) * BigInt(TOKENS_PER_RATE_UNIT),
    };
  });

  const total = byTool.reduce((sum, entry) => sum + entry.operations, 0);
  const sources = sourceRange(total);
  const passes = DEPTH_PRESETS[depth].synthesisPasses;
  const synthesisCalls = { min: sources.min + passes, max: sources.max + passes };

  let costCents: Range | null = null;
  if (synthesisRates !== null) {
    const input = scaledRate(synthesisRates.inputCentsPer1m);
    const output = scaledRate(synthesisRates.outputCentsPer1m);
    const digest = scaledCallCost(DIGEST_CALL, input, output);
    const synthesis = scaledCallCost(SYNTHESIS_CALL, input, output) * BigInt(passes);
    const hosted = byTool.reduce((sum, entry) => sum + (entry.scaledHosted ?? 0n), 0n);

    costCents = {
      min: floorDiv(BigInt(sources.min) * digest + synthesis + hosted, CENT_DIVISOR),
      max: ceilDiv(BigInt(sources.max) * digest + synthesis + hosted, CENT_DIVISOR),
    };
  }

  return {
    calibrationVersion: CALIBRATION_VERSION,
    operations: {
      total,
      byTool: byTool.map(({ tool, operations, scaledHosted }) => ({
        tool,
        operations,
        hostedCostCents: scaledHosted === null ? null : ceilDiv(scaledHosted, CENT_DIVISOR),
      })),
    },
    synthesisCalls,
    sources,
    costCents,
  };
}

/**
 * Renders a range as the composer prints it — `40–60`, or `40` when both ends agree.
 *
 * @param range - The range.
 * @returns The text, with an en dash.
 */
export function renderRange(range: Range): string {
  return range.min === range.max ? String(range.min) : `${range.min}–${range.max}`;
}

/**
 * Renders a cost range as one approximate figure — the composer's `~$6`.
 *
 * The midpoint, rounded to whole dollars: the estimate is a range and the line is a glance, so
 * cents would claim a precision the calibration does not have. `$0` only for a range that is
 * zero at both ends (a free model, priced at nothing); `<$1` for a non-zero range whose midpoint
 * rounds to nothing, so a real cost never reads as free.
 *
 * @param cost - The cost range in cents.
 * @returns `~$6`, `<$1` or `$0`.
 */
export function renderCost(cost: Range): string {
  if (cost.max === 0) {
    return "$0";
  }
  const dollars = Math.round((cost.min + cost.max) / 2 / 100);
  return dollars < 1 ? "<$1" : `~$${dollars}`;
}

/**
 * The composer's estimate line — `est. 40–60 sources · ~$6`, or `est. 40–60 sources` when the
 * alias is unpriced. Composed once, here, so every surface prints the same words.
 *
 * @param estimate - The estimate.
 * @returns The line. Contains a `$` only when `costCents` is present.
 */
export function renderEstimateLabel(
  estimate: Pick<ScopeEstimate, "sources" | "costCents">,
): string {
  const sources = `est. ${renderRange(estimate.sources)} sources`;
  return estimate.costCents === null ? sources : `${sources} · ${renderCost(estimate.costCents)}`;
}
