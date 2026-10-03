/**
 * The corpus manifest — the receipt a Build Analyzer run stores for what it read (BV.1,
 * [#510](https://github.com/NobuData/ouroboros/issues/510); the contract is V080's
 * `analysis_corpus_manifest_valid()`, #506).
 *
 * Mockup 18's meta strip — `Corpus 1,284 builds · 312 loops · 90 days · 4.1M log lines · 62 HIL
 * sessions` — is this document rendered. Everything here is pure: the window a run reads, the
 * sampling record a bound source carries, the confidence note, and the manifest's own shape. The
 * readers that fill it are `corpus.assembler.ts`.
 *
 * **A count is what lies inside the window; a sampling record is how much of it was read.** The
 * two are different questions and the manifest answers both: `counts.log_lines` is every line the
 * window's builds stored, counted without reading one (`build_jobs.log_lines`, V086), and
 * `sources.log_lines` says what fraction of that volume the run's tails were drawn from and which
 * budget stopped it. A finding computed from 30 % of the logs is still worth having; presenting it
 * as exhaustive is not.
 */

import { addDays, utcDay } from "../../insights/rollup/rollup.days";

/** How many days a corpus spans — the strip's `90 days`. */
export const CORPUS_DAYS = 90;

/**
 * The fewest days with a build a corpus must hold before what an analysis says about it is shown
 * (BW.6, [#521](https://github.com/NobuData/ouroboros/issues/521)).
 *
 * It is the change-point analyzer's own floor, restated: `change_point` v1 compares two segments
 * of at least `min_segment_days` (5) observed days each, so under ten it can detect nothing and
 * the chart it annotates would be a handful of points. `corpus.manifest.spec.ts` reads the
 * engine's source and holds this number to twice that parameter.
 *
 * A **proxy**, and said so: a day counts when any build of the repository finished on it
 * ({@link StabilityInput.daysWithBuilds}), while the analyzer counts days with a *successful
 * build of the duration label*. A corpus can clear this floor and still be too thin for the
 * analyzer; the chart's own read is what the page checks for that.
 */
export const MINIMUM_DAYS_WITH_BUILDS = 10;

/**
 * Whether a corpus holds enough history for its analysis to be shown.
 *
 * @param daysWithBuilds - Days of the window on which at least one build finished.
 * @returns True at or above {@link MINIMUM_DAYS_WITH_BUILDS}.
 */
export function corpusSufficient(daysWithBuilds: number): boolean {
  return daysWithBuilds >= MINIMUM_DAYS_WITH_BUILDS;
}

/** The budget keys a sampling record may name as its binding cap (V080). */
export const BUDGET_KEYS = ["max_builds", "max_log_lines", "compute_ceiling_seconds"] as const;

/** One of {@link BUDGET_KEYS}. */
export type BudgetKey = (typeof BUDGET_KEYS)[number];

/** The four sources the strip counts, as the manifest keys them. */
export const COUNT_KEYS = ["builds", "loops", "log_lines", "hil_sessions"] as const;

/** One of {@link COUNT_KEYS}. */
export type CountKey = (typeof COUNT_KEYS)[number];

/** The caps a run is assembled under — the schedule's columns, copied at start. */
export interface CorpusBudget {
  maxBuilds: number;
  maxLogLines: number;
  computeCeilingSeconds: number;
}

/** The budget V080's columns default to, for a repository with no schedule row. */
export const DEFAULT_BUDGET: CorpusBudget = {
  maxBuilds: 2000,
  maxLogLines: 5_000_000,
  computeCeilingSeconds: 3600,
};

/** The corpus bounds, as UTC days inclusive at both ends. */
export interface CorpusWindow {
  from: string;
  to: string;
  days: number;
}

/** One source's sampling record — V080's `{sampled, rate, cap}`. */
export interface SamplingRecord {
  sampled: boolean;
  /** The fraction read: exactly 1 when read in full, strictly between 0 and 1 when sampled. */
  rate: number;
  /** The budget that bound it; null when nothing did. */
  cap: BudgetKey | null;
}

/** A source the corpus does not carry, and why — never a zero standing in for it. */
export interface AbsentSource {
  source: string;
  reason: string;
}

/** What became of each analyzer — added when the run ends. */
export interface ManifestAnalyzers {
  completed: string[];
  skipped: string[];
  failed: string[];
  not_run: string[];
}

/** The stored manifest, in the database's names. */
export interface CorpusManifest {
  window: CorpusWindow;
  counts: Record<CountKey, number>;
  sources: Record<CountKey, SamplingRecord>;
  budget: { max_builds: number; max_log_lines: number; compute_ceiling_seconds: number };
  /**
   * The job label whose durations are the duration series, or null when nothing succeeded.
   * Optional because a manifest written before #510 (a seeded run) does not carry it.
   */
  duration_label?: string | null;
  /**
   * Sources the corpus lacks, by name — an honest missing input rather than a fabricated one.
   * Optional for the same reason.
   */
  absent?: AbsentSource[];
  /** Set when the run ends: which analyzers completed and which did not. */
  analyzers?: ManifestAnalyzers;
  /**
   * Set when the run ends with a confidence note (#516): what produced it. Optional because a run
   * that failed has no note, and one written before #516 carries no basis.
   */
  confidence?: ConfidenceBasis;
}

/**
 * The window a run reads: the {@link CORPUS_DAYS} whole UTC days before the day it started.
 *
 * Today is excluded because it is not over — a corpus that included it would change under a
 * second read of the same run.
 *
 * @param startedAt - When the run started.
 * @returns The window.
 */
export function corpusWindow(startedAt: Date): CorpusWindow {
  const to = addDays(utcDay(startedAt), -1);

  return { from: addDays(to, -(CORPUS_DAYS - 1)), to, days: CORPUS_DAYS };
}

/** The record of a source read in full. */
export const FULL_READ: SamplingRecord = Object.freeze({ sampled: false, rate: 1, cap: null });

/**
 * The sampling record for a source of which `read` of `total` units were read.
 *
 * The rate is rounded to two places — the precision the strip and a person can use — and kept
 * strictly inside (0, 1) when the source *was* sampled, because V080 refuses a sampled rate of 0
 * or 1: 0.004 of the logs is "some", not "none", and 0.996 is still not all of them.
 *
 * @param read - Units read (builds, lines…).
 * @param total - Units inside the window.
 * @param cap - The budget that stopped the read, when one did.
 * @returns {@link FULL_READ} when everything was read, otherwise a sampled record naming `cap`.
 * @throws {RangeError} When `read` exceeds `total` or either is negative, or a partial read names
 *   no cap — a sample with no reason is a bug, not a record.
 */
export function samplingRecord(read: number, total: number, cap: BudgetKey | null): SamplingRecord {
  if (read < 0 || total < 0 || read > total) {
    throw new RangeError(`cannot have read ${String(read)} of ${String(total)}`);
  }

  if (read === total) {
    return FULL_READ;
  }

  if (cap === null) {
    throw new RangeError(`read ${String(read)} of ${String(total)} with no budget to say why`);
  }

  const rate = Math.min(0.99, Math.max(0.01, Math.round((read / total) * 100) / 100));

  return { sampled: true, rate, cap };
}

/**
 * The budget as the manifest stores it.
 *
 * @param budget - The run's caps.
 * @returns The same caps under V080's keys.
 */
export function manifestBudget(budget: CorpusBudget): CorpusManifest["budget"] {
  return {
    max_builds: budget.maxBuilds,
    max_log_lines: budget.maxLogLines,
    compute_ceiling_seconds: budget.computeCeilingSeconds,
  };
}

/** What a corpus-stability judgement reads. */
export interface StabilityInput {
  window: CorpusWindow;
  /** Builds inside the window. */
  builds: number;
  /** Days of the window on which at least one build finished. */
  daysWithBuilds: number;
}

/** The three confidence levels, strongest first. */
export type ConfidenceLevel = "high" | "medium" | "low";

/** One level's bar: the share of the window's days with a build, and the builds a day. */
export interface ConfidenceThreshold {
  coverage: number;
  per_day: number;
}

/**
 * The rule {@link confidenceNote} applies, as data — stored with every basis so a reader of an old
 * run sees the bar it was judged against, not today's.
 */
export const CONFIDENCE_RULE: Readonly<
  Record<Exclude<ConfidenceLevel, "low">, ConfidenceThreshold>
> = Object.freeze({
  high: Object.freeze({ coverage: 0.9, per_day: 5 }),
  medium: Object.freeze({ coverage: 0.6, per_day: 1 }),
});

/**
 * What produced a run's confidence note — stored in the manifest under `confidence` (BW.1,
 * [#516](https://github.com/NobuData/ouroboros/issues/516)) so the strip's popover shows the
 * computed basis rather than a label nobody can interrogate.
 */
export interface ConfidenceBasis {
  level: ConfidenceLevel;
  window_days: number;
  builds: number;
  days_with_builds: number;
  /** `days_with_builds ÷ window_days`, rounded to four places. */
  coverage: number;
  /** `builds ÷ window_days`, rounded to four places. */
  per_day: number;
  rule: { high: ConfidenceThreshold; medium: ConfidenceThreshold };
}

/**
 * Round a ratio to four places — enough to compare against a two-place threshold honestly.
 *
 * @param value - The ratio.
 * @returns It, rounded.
 */
function ratio(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * The corpus-stability judgement, with its inputs.
 *
 * The rule is deliberately simple and stated here, because the note is shown beside every finding
 * and a reader must be able to check it:
 *
 *   * **high** — builds on at least 90 % of the window's days and at least five a day on average;
 *   * **medium** — builds on at least 60 % of the days and at least one a day on average;
 *   * **low** — anything thinner.
 *
 * The comparison uses the unrounded ratios; the stored `coverage` and `per_day` are rounded for
 * reading only.
 *
 * @param input - The window, its build count and how many of its days had builds.
 * @returns The level reached, the inputs and ratios, and the rule applied.
 */
export function confidenceBasis(input: StabilityInput): ConfidenceBasis {
  const { window, builds, daysWithBuilds } = input;
  const coverage = daysWithBuilds / window.days;
  const perDay = builds / window.days;
  const meets = (bar: ConfidenceThreshold): boolean =>
    coverage >= bar.coverage && perDay >= bar.per_day;

  const level: ConfidenceLevel = meets(CONFIDENCE_RULE.high)
    ? "high"
    : meets(CONFIDENCE_RULE.medium)
      ? "medium"
      : "low";

  return {
    level,
    window_days: window.days,
    builds,
    days_with_builds: daysWithBuilds,
    coverage: ratio(coverage),
    per_day: ratio(perDay),
    rule: { high: { ...CONFIDENCE_RULE.high }, medium: { ...CONFIDENCE_RULE.medium } },
  };
}

/**
 * The strip's `Confidence: high — 90d of stable telemetry`, computed by {@link confidenceBasis}.
 *
 * Sampling is not repeated here: the manifest's per-source record already says what was read,
 * and the strip renders it beside the note.
 *
 * @param input - The window, its build count and how many of its days had builds.
 * @returns The note, e.g. `high — 90d of stable telemetry`.
 */
export function confidenceNote(input: StabilityInput): string {
  const { level } = confidenceBasis(input);
  const { window, builds, daysWithBuilds } = input;

  if (level === "high") {
    return `high — ${String(window.days)}d of stable telemetry`;
  }

  if (level === "medium") {
    return `medium — builds on ${String(daysWithBuilds)} of ${String(window.days)} days`;
  }

  return `low — ${String(builds)} builds over ${String(window.days)} days`;
}
