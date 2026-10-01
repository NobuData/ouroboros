import type { HBarRow, TimeSeriesPoint, VBarDay } from "@/app/charts";
import { moneyOfCents } from "@/app/format";

/**
 * Mockup 15's chart data, transcribed — the fixtures the chart story
 * ([#442](https://github.com/NobuData/ouroboros/issues/442)) draws and its tests render.
 *
 * Read back out of the mockup's own geometry (each polyline's y, each bar's height) rather
 * than invented, so a render of these beside the mockup is a like-for-like comparison.
 * Deterministic: a screenshot baseline taken against a fixture that moved would be noise.
 */

/** The thirty days the mockup's charts span: Jul 10 – Aug 8. */
const DAYS: readonly string[] = Array.from({ length: 30 }, (_, index) =>
  index < 22 ? `Jul ${10 + index}` : `Aug ${index - 21}`,
);

/** Merged PRs per day, read off the throughput polyline (`(166 − y) / 21`). */
const MERGED: readonly number[] = [
  3, 1, 0, 3, 4, 3, 4, 4, 1, 1, 4, 5, 4, 5, 4, 1, 2, 5, 4, 6, 5, 5, 2, 1, 5, 6, 5, 6, 5, 6,
];

/** Interventions per day for the tooltip — the mockup's Aug 4 has one. */
const INTERVENTIONS: readonly number[] = [
  1, 0, 0, 2, 1, 0, 1, 0, 2, 1, 0, 1, 0, 0, 1, 2, 1, 0, 0, 1, 0, 1, 2, 1, 0, 1, 0, 0, 1, 0,
];

/** Spend per day on the merged work, in cents — the mockup's Aug 4 is `$9.12`. */
const SPEND_CENTS: readonly number[] = MERGED.map((merged, index) =>
  index === 25 ? 912 : 140 + merged * 152,
);

/**
 * The throughput card's series: thirty days, ending at `6`, with the tooltip's detail on each.
 */
export const THROUGHPUT: readonly TimeSeriesPoint[] = MERGED.map((value, index) => {
  const interventions = INTERVENTIONS[index]!;

  return {
    label: DAYS[index]!,
    value,
    meta: `${value} merged · ${moneyOfCents(SPEND_CENTS[index]!)} · ${interventions} intervention${interventions === 1 ? "" : "s"}`,
  };
});

/** Daily cost in cents, read off the cost polyline — rising to `$18.60`, spiking to `$31.40`. */
export const DAILY_COST: readonly TimeSeriesPoint[] = [
  1310, 1410, 1280, 1510, 1440, 1570, 1510, 1630, 1510, 1570, 1670, 1600, 1730, 1670, 1700,
  1600, 1670, 1790, 1700, 1830, 1950, 3140, 2470, 1990, 1830, 1920, 1830, 1890, 1790, 1860,
].map((value, index) => ({ label: DAYS[index]!, value }));

/** The daily cost card's budget guide: `$20`. */
export const COST_BUDGET_CENTS = 2000;

/** The index of the Zephyr migration spike in {@link DAILY_COST}. */
export const COST_SPIKE_INDEX = 21;

/** Where loops still need humans — 30 days, 20 interventions. */
export const INTERVENTION_CAUSES: readonly HBarRow[] = [
  { name: "Flaky env / rig", value: 8, emphasis: "top" },
  { name: "Ambiguous ticket", value: 5 },
  { name: "Policy gate (refactor)", value: 4 },
  { name: "Model disagreement", value: 2, emphasis: "dim" },
  { name: "Other", value: 1, emphasis: "dim" },
];

/** Cycle time by stage, median, in milliseconds. */
export const STAGE_MEDIANS_MS: readonly { readonly name: string; readonly ms: number }[] = [
  { name: "Analyze", ms: 60_000 },
  { name: "Plan", ms: 120_000 },
  { name: "Implement", ms: 364_000 },
  { name: "Build", ms: 120_000 },
  { name: "Test", ms: 160_000 },
  { name: "Verify", ms: 40_000 },
];

/** Time to completion by effort, median, in milliseconds. */
export const EFFORT_LADDER_MS: readonly {
  readonly effort: "XS" | "S" | "M" | "L" | "XL";
  readonly ms: number;
}[] = [
  { effort: "XS", ms: 360_000 },
  { effort: "S", ms: 660_000 },
  { effort: "M", ms: 1_140_000 },
  { effort: "L", ms: 2_880_000 },
  { effort: "XL", ms: 7_800_000 },
];

/** Tokens by stage, 30 days. */
export const TOKENS_BY_STAGE: readonly { readonly name: string; readonly tokens: number }[] = [
  { name: "Implement", tokens: 126_000_000 },
  { name: "Plan", tokens: 41_200_000 },
  { name: "Analyze", tokens: 26_400_000 },
  { name: "Verify", tokens: 18_900_000 },
  { name: "Test", tokens: 6_100_000 },
  { name: "Build", tokens: 980_000 },
];

/** The flaky card's three histories, and the DORA cells' four. */
export const SPARKS = {
  fixed: [14, 16, 12, 15, 10, 13, 8, 6, 4, 2, 2, 2],
  rising: [3, 4, 3, 6, 5, 8, 7, 10, 9, 13, 15, 17],
  watching: [2, 3, 2, 2, 4, 3, 2, 5, 4, 5, 6, 7],
  deploys: [6, 8, 7, 10, 9, 12, 14, 16],
  leadTime: [16, 15, 13, 14, 11, 10, 8, 7],
  failureRate: [6, 7, 6, 8, 6, 7, 6, 7],
} as const;

/**
 * Builds per day as `[failed, succeeded]` pixel heights, read off the mockup's `.vb` bars at
 * four pixels a build.
 */
const BUILD_HEIGHTS: readonly (readonly [number, number])[] = [
  [0, 56], [0, 20], [0, 16], [16, 48], [0, 60], [0, 56], [0, 68], [8, 64], [0, 24], [0, 16],
  [20, 48], [0, 60], [0, 64], [12, 44], [0, 64], [0, 20], [0, 12], [24, 48], [0, 60], [0, 68],
  [0, 64], [0, 56], [0, 24], [0, 16], [28, 48], [0, 64], [16, 44], [0, 68], [16, 56], [0, 24],
];

/** Builds per day, 30 days — failures clustered on eight of them. */
export const BUILDS_PER_DAY: readonly VBarDay[] = BUILD_HEIGHTS.map(([failed, ok], index) => ({
  label: DAYS[index]!,
  succeeded: ok / 4,
  failed: failed / 4,
}));

/** The day the builds card's note floats over: `18 · 2 failed`. */
export const BUILDS_NOTE_INDEX = 7;
