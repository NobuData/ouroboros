/**
 * The shapes the model scoreboard answers with (BJ.3,
 * [#439](https://github.com/NobuData/ouroboros/issues/439)).
 */

import type { MetricMethodology } from "../metrics/metrics.types";
import type { DaySpan, MetricRange } from "../metrics/metrics.window";

/** Who and what a scoreboard is about. */
export interface ScoreboardScope {
  /** The workspace, from the tenant context. Every statement filters on it. */
  readonly organizationId: string;
  /** One repository's `owner/name`, or undefined for the whole workspace. */
  readonly repo?: string;
  /** The range; the prior window is the same length, immediately before. */
  readonly range: MetricRange;
  /** The instant to answer at; the service's clock when omitted. */
  readonly now?: Date;
}

/**
 * Which hop of the resolved chain served a row: the first hop is the `primary`, any later one a
 * `fallback` — reached only when every hop before it was dropped or failed.
 */
export type ScoreboardRole = "primary" | "fallback";

/** A row's identity: task kind × the serving model × the hop it served from. */
export interface ScoreboardKey {
  /** `task_kinds.name` as the resolution recorded it — `implement`. */
  readonly taskKind: string;
  /** The serving hop's raw model id, opaque — `claude-fable-5`, `ollama/qwen3-coder`. */
  readonly model: string;
  /** The hop's 1-based place in the resolved chain, dropped hops included. */
  readonly hop: number;
}

/** One row's figures over one window, as the statement groups them. */
export interface ScoreboardTally extends ScoreboardKey {
  /** Loop PRs merged in the window whose run this row served. */
  readonly merged: number;
  /** Of those, the ones decision I6 calls untouched. */
  readonly untouched: number;
  /** Every token the row's runs spent on its task kind in the window. */
  readonly tokens: number;
  /** The part of {@link ScoreboardTally.tokens} no price covered. */
  readonly unpricedTokens: number;
  /** Priced spend in cents, or null when no usage in the row was priced. */
  readonly costCents: number | null;
}

/**
 * The `$ / success` column.
 *
 * - `priced`: every token in the row was priced. `centsPerSuccess` is spend ÷ merges — `0` for a
 *   local model priced at zero — or null with no merge to divide by.
 * - `unpriced`: some usage had no price, so the row shows tokens per success and never a dollar
 *   figure (a partial one would understate the cost).
 * - `none`: the row's runs recorded no usage for its task kind in the window.
 */
export type ScoreboardCost =
  | {
      readonly pricing: "priced";
      readonly cents: number;
      readonly centsPerSuccess: number | null;
    }
  | {
      readonly pricing: "unpriced";
      readonly tokens: number;
      readonly unpricedTokens: number;
      readonly tokensPerSuccess: number | null;
    }
  | { readonly pricing: "none" };

/**
 * The trend arrow: the row's untouched rate against the same row's in the prior window.
 *
 * `direction` is `flat` both when the rate did not move and when either window has no rate to
 * compare (`delta` null) — the mockup's `—`.
 */
export interface ScoreboardTrend {
  readonly direction: "up" | "down" | "flat";
  /** The prior window's untouched rate (0–100), or null when the row had no merges then. */
  readonly prior: number | null;
  /** `current − prior` in points, or null when either is null. */
  readonly delta: number | null;
}

/** One scoreboard row. */
export interface ScoreboardRow extends ScoreboardKey {
  readonly role: ScoreboardRole;
  /** The merges backing the row — the sample. */
  readonly merged: number;
  readonly untouched: number;
  /** `untouched ÷ merged × 100`, or null when nothing merged. */
  readonly untouchedRate: number | null;
  readonly cost: ScoreboardCost;
  readonly trend: ScoreboardTrend;
  /** True when {@link ScoreboardRow.merged} is below the threshold: shown, with its caveat. */
  readonly lowSample: boolean;
}

/**
 * Learned routing suggestion AB.3's payload ([#209](https://github.com/NobuData/ouroboros/issues/209)).
 * Its shape is AB.3's to define; the scoreboard passes it through untouched (decision I10).
 */
export type ScoreboardSuggestion = Readonly<Record<string, unknown>>;

/**
 * Where the suggestion row comes from. Bound under `SCOREBOARD_SUGGESTIONS` by AB.3 when it
 * exists; unbound, the scoreboard has no suggestion and never composes one of its own.
 */
export interface ScoreboardSuggestionSource {
  /**
   * The suggestion for a scoreboard, if AB.3 has one.
   *
   * @param scope - The scoreboard's scope.
   * @param rows - The rows the suggestion would sit beside.
   * @returns The payload, or null for none.
   */
  suggestion(
    scope: ScoreboardScope,
    rows: readonly ScoreboardRow[],
  ): Promise<ScoreboardSuggestion | null>;
}

/** The registry entry behind each column — every column's popover (decision I1). */
export interface ScoreboardMethodology {
  /** `merged_untouched_rate` — the KPI row's own entry (I6: one definition). */
  readonly untouched: MetricMethodology;
  readonly costPerSuccess: MetricMethodology;
  readonly trend: MetricMethodology;
  /** What groups a row, what *fallback* means and the low-sample threshold. */
  readonly sample: MetricMethodology;
}

/** Mockup 15's MODEL SCOREBOARD. */
export interface Scoreboard {
  readonly range: MetricRange;
  /** The window's first and last UTC day. */
  readonly window: DaySpan;
  /** The prior window of equal length the trend compares against. */
  readonly prior: DaySpan;
  /** Rows backed by fewer merges than this carry `lowSample`. */
  readonly minSample: number;
  /** The busiest task kind first; within one, primary before fallback, then the busier model. */
  readonly rows: readonly ScoreboardRow[];
  readonly methodology: ScoreboardMethodology;
  /** AB.3's payload; the key is absent — not null — when AB.3 is absent or has nothing to say. */
  readonly suggestion?: ScoreboardSuggestion;
}
