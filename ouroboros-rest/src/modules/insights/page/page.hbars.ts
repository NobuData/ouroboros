/**
 * The Insights page's five bar cards and their insight lines (BJ.2,
 * [#438](https://github.com/NobuData/ouroboros/issues/438), decision **I5**).
 *
 * Pure: breakdowns in, cards out. A card's bars are a `MetricBreakdown` the windowed metrics
 * service answered, ordered and labelled here.
 *
 * **Every insight line is arithmetic over the bars it sits under**, phrased conservatively, and
 * null when the window gives it nothing true to say:
 *
 * ```
 * interventions  8 of 20        →  "Fix the top row and interventions drop ~40%."
 * stages         Σ other medians →  "Implement dominates the loop — the other five stages sum to 8m 20s."
 * suites         33 / 26 430    →  "33 failing cases total — 0.12% of everything that ran."
 * effort         8 of 9 graded  →  "Estimator calibration: 89% of issues land within their predicted band."
 * tokens         Σ / merged, local / Σ → "≈ 1.3M tokens per merged PR · 31% served by local models."
 * ```
 *
 * A line shipped as a literal would be right on the seeded data and wrong ever after, in a way
 * that reads as authoritative — so none is a literal, and `page.hbars.spec.ts` moves the data
 * under each one and watches the sentence move.
 */

import type { CalibrationReport } from "../calibration.rules";
import type { MetricBreakdown } from "../metrics/metrics.types";
import { windowOf, type Windows } from "./page.cards";
import { formatCompact, formatCountWord, formatDuration, formatShare } from "./page.format";
import type { InsightsBar, InsightsBarCard, InsightsBarCards } from "./page.resources";

/** What a cause is called on the card — mockup 15's names for V079's cause ids. */
export const CAUSE_LABELS: Readonly<Record<string, string>> = {
  infra_rig: "Flaky env / rig",
  ambiguous_ticket: "Ambiguous ticket",
  policy_gate: "Policy gate",
  model_disagreement: "Model disagreement",
  other: "Other",
};

/** The loop's stages in the order a loop passes through them; an unknown stage sorts after. */
export const STAGE_ORDER: readonly string[] = [
  "analyze",
  "plan",
  "implement",
  "build",
  "test",
  "review",
  "verify",
];

/** Stage keys the card names differently: the loop's self-review is mockup 15's *Verify*. */
const STAGE_LABELS: Readonly<Record<string, string>> = { review: "Verify" };

/** The estimate sizes, smallest first. */
export const EFFORT_ORDER: readonly string[] = ["xs", "s", "m", "l", "xl"];

/** The breakdowns the cards are drawn from. */
export interface BarBreakdowns {
  readonly interventions: MetricBreakdown;
  readonly stages: MetricBreakdown;
  readonly suites: MetricBreakdown;
  readonly effort: MetricBreakdown;
  readonly tokens: MetricBreakdown;
}

/**
 * A stored key as a card label: `test-gen` → `Test-gen`.
 *
 * @param key - The key.
 * @returns It, with its first letter capitalised.
 */
function titled(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/**
 * A breakdown's bars: every label with a figure in the window.
 *
 * @param breakdown - The breakdown.
 * @param label - What a key is called on the card.
 * @returns The bars, unordered. A label with nothing this window (null, or a count of zero) has
 *   no bar — a card does not draw empty rows.
 */
function barsOf(breakdown: MetricBreakdown, label: (key: string) => string): InsightsBar[] {
  return breakdown.entries.flatMap(({ dimension, window }) =>
    window.value === null || window.value <= 0
      ? []
      : [{ key: dimension, label: label(dimension), value: window.value }],
  );
}

/** Largest first, then by key — a total order, so two machines draw the same card. */
function byValue(a: InsightsBar, b: InsightsBar): number {
  return b.value - a.value || a.key.localeCompare(b.key);
}

/**
 * Bars in a fixed vocabulary's order, anything outside it after, by key.
 *
 * @param order - The vocabulary.
 * @returns The comparator.
 */
function byOrder(order: readonly string[]): (a: InsightsBar, b: InsightsBar) => number {
  const rank = (key: string): number => {
    const index = order.indexOf(key);

    return index === -1 ? order.length : index;
  };

  return (a, b) => rank(a.key) - rank(b.key) || a.key.localeCompare(b.key);
}

/** The bars' sum. */
function totalOf(bars: readonly InsightsBar[]): number {
  return bars.reduce((total, bar) => total + bar.value, 0);
}

/**
 * *Where loops still need humans.*
 *
 * @param breakdown - `human_interventions` by cause.
 * @returns The card; its line is the top cause's share of every intervention.
 */
export function interventionsCard(breakdown: MetricBreakdown): InsightsBarCard {
  const bars = barsOf(breakdown, (key) => CAUSE_LABELS[key] ?? titled(key)).sort(byValue);
  const total = totalOf(bars);

  return {
    unit: breakdown.methodology.unit,
    total,
    bars,
    line:
      total > 0
        ? `Fix the top row and interventions drop ~${formatShare(bars[0].value, total)}.`
        : null,
    methodology: breakdown.methodology,
  };
}

/**
 * *Cycle time by stage · median.*
 *
 * @param breakdown - `stage_duration` by stage.
 * @returns The card; its line names the longest stage and sums the others' medians.
 */
export function stagesCard(breakdown: MetricBreakdown): InsightsBarCard {
  const bars = barsOf(breakdown, (key) => STAGE_LABELS[key] ?? titled(key)).sort(
    byOrder(STAGE_ORDER),
  );
  let line: string | null = null;

  if (bars.length > 1) {
    const top = [...bars].sort(byValue)[0];
    const others = bars.filter((bar) => bar !== top);
    const one = others.length === 1;

    line =
      `${top.label} dominates the loop — the other ${one ? "stage takes" : `${formatCountWord(others.length)} stages sum to`} ` +
      `${formatDuration(totalOf(others))}.`;
  }

  // Medians do not add up to a median, so the card has no total.
  return {
    unit: breakdown.methodology.unit,
    total: null,
    bars,
    line,
    methodology: breakdown.methodology,
  };
}

/**
 * *Test failures by suite.*
 *
 * @param breakdown - `test_failures_by_suite` by suite.
 * @param casesRun - The window's `test_cases_run`, or null.
 * @returns The card; its line is the failing cases' share of everything that ran.
 */
export function suitesCard(breakdown: MetricBreakdown, casesRun: number | null): InsightsBarCard {
  const bars = barsOf(breakdown, (key) => key).sort(byValue);
  const total = totalOf(bars);

  return {
    unit: breakdown.methodology.unit,
    total,
    bars,
    line:
      total > 0 && casesRun !== null && casesRun > 0
        ? `${String(total)} failing ${total === 1 ? "case" : "cases"} total — ` +
          `${formatShare(total, casesRun)} of everything that ran.`
        : null,
    methodology: breakdown.methodology,
  };
}

/**
 * *Time to completion by effort.*
 *
 * @param breakdown - `completion_time_by_effort` by effort.
 * @param calibration - #435's report for the same range.
 * @returns The card; its line is the estimator's calibration, when anything was graded.
 */
export function effortCard(
  breakdown: MetricBreakdown,
  calibration: Pick<CalibrationReport, "withinBandPct">,
): InsightsBarCard {
  return {
    unit: breakdown.methodology.unit,
    total: null,
    bars: barsOf(breakdown, (key) => key.toUpperCase()).sort(byOrder(EFFORT_ORDER)),
    line:
      calibration.withinBandPct === null
        ? null
        : `Estimator calibration: ${String(Math.round(calibration.withinBandPct))}% of issues ` +
          "land within their predicted band.",
    methodology: breakdown.methodology,
  };
}

/**
 * *Tokens by stage.*
 *
 * The total is every token in the window, not the bars' sum: usage recorded with no task kind is
 * in the total and in no bar (the registry's caveat).
 *
 * @param breakdown - `tokens_by_task_kind` by task kind.
 * @param windows - The range's windows: `tokens`, `local_tokens` and `merged_prs`.
 * @returns The card; its line is tokens per merged PR and the share local models served — each
 *   part only when it can be computed.
 */
export function tokensCard(breakdown: MetricBreakdown, windows: Windows): InsightsBarCard {
  const tokens = windowOf(windows, "tokens").value ?? 0;
  const local = windowOf(windows, "local_tokens").value ?? 0;
  const merged = windowOf(windows, "merged_prs").value ?? 0;
  const parts = [
    tokens > 0 && merged > 0 ? `≈ ${formatCompact(tokens / merged)} tokens per merged PR` : null,
    tokens > 0 && local > 0 ? `${formatShare(local, tokens)} served by local models` : null,
  ].filter((part): part is string => part !== null);

  return {
    unit: breakdown.methodology.unit,
    total: tokens,
    bars: barsOf(breakdown, (key) => key).sort(byValue),
    line: parts.length === 0 ? null : `${parts.join(" · ")}.`,
    methodology: breakdown.methodology,
  };
}

/**
 * All five cards.
 *
 * @param breakdowns - The five breakdowns.
 * @param windows - The range's windows.
 * @param calibration - #435's report.
 * @returns The cards.
 */
export function barCardsOf(
  breakdowns: BarBreakdowns,
  windows: Windows,
  calibration: Pick<CalibrationReport, "withinBandPct">,
): InsightsBarCards {
  return {
    interventions: interventionsCard(breakdowns.interventions),
    stages: stagesCard(breakdowns.stages),
    suites: suitesCard(breakdowns.suites, windowOf(windows, "test_cases_run").value),
    effort: effortCard(breakdowns.effort, calibration),
    tokens: tokensCard(breakdowns.tokens, windows),
  };
}
