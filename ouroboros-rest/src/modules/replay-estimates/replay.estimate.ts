/**
 * A replay estimate: what the sample says, or that it says too little (CD.3,
 * [#561](https://github.com/NobuData/ouroboros/issues/561)).
 *
 * Pure. The database returns a sample — a count, a median and a spread over the similar history
 * (V121) — and this module decides what may be said about it:
 *
 * ```
 * sample ──▶ n ≥ floor? ──yes──▶ estimate {median, ± spread, n, window}
 *                        └─no──▶ insufficient_history {found: n}   — never a number
 * ```
 *
 * Three rules, each with a function that enforces it:
 *
 *   * **An estimate travels with its basis.** Median, spread, sample count and window are one
 *     answer; {@link assertCompleteEstimate} is the probe that refuses one missing any of them,
 *     and the service runs every result through it before it leaves.
 *   * **Below the floor there is no number.** {@link composeEstimate} returns
 *     `insufficient_history` with the count it found, and that shape has no field a number
 *     could sit in.
 *   * **Cache context is context.** The warm and cold halves of the sample are reported beside
 *     the estimate ({@link cacheContext}) and never folded into it.
 */

import { type ReplayFormula, type ReplayKind, replayFormula } from "./replay.formulas";

/** The window and floor a sample is held to — `replay_estimate_policy()` (V121). */
export interface ReplayPolicy {
  /** How many days of history the sample was read over. */
  readonly windowDays: number;
  /** The fewest samples an estimate may rest on. */
  readonly sampleFloor: number;
}

/** A sample's statistics, as the database computed them. */
export interface ReplaySample {
  /** How many similar builds or test runs were found in the window. */
  readonly sampleCount: number;
  /** Their median wall time; `null` when none was found. */
  readonly medianMs: number | null;
  /** Their median absolute deviation; `null` when none was found. */
  readonly spreadMs: number | null;
}

/** The cache halves of a build sample, as the database counted them. */
export interface CacheSample {
  /** The sampled builds that reported ccache statistics. */
  readonly measured: number;
  /** Those with a hit rate of at least one half. */
  readonly warmCount: number;
  /** Their median wall time; `null` when there are none. */
  readonly warmMedianMs: number | null;
  /** Those with a hit rate below one half. */
  readonly coldCount: number;
  /** Their median wall time; `null` when there are none. */
  readonly coldMedianMs: number | null;
}

/** One half of the cache context. */
export interface CacheHalf {
  /** How many sampled builds fell in it. */
  readonly count: number;
  /** Their median wall time. */
  readonly medianMs: number;
}

/** What the sampled builds' cache statistics say — beside the estimate, never inside it. */
export interface CacheContext {
  /** The sampled builds that reported ccache statistics. */
  readonly measured: number;
  /** The warm builds (hit rate ≥ ½), or `null` when there were none. */
  readonly warm: CacheHalf | null;
  /** The cold builds (hit rate < ½), or `null` when there were none. */
  readonly cold: CacheHalf | null;
  /** The range, in words — `warm cache ≈ 3m 41s (202 builds) · cold cache ≈ 6m 50s (29 builds)`. */
  readonly note: string;
}

/** A formula with the inputs this estimate was computed from. */
export interface AppliedFormula extends ReplayFormula {
  /** The real inputs, for the Details popover. */
  readonly inputs: {
    /** The similarity class the sample was matched on. */
    readonly similarityClass: string;
    /** The window read, in days. */
    readonly windowDays: number;
    /** The sample floor in force. */
    readonly sampleFloor: number;
    /** How many samples matched. */
    readonly sampleCount: number;
  };
}

/** What every result carries, whichever way it went. */
interface ReplayResultBase {
  /** What was estimated. */
  readonly kind: ReplayKind;
  /** The similarity class the sample was matched on, as printed. */
  readonly similarityClass: string;
  /** The window the sample was read over, in days. */
  readonly windowDays: number;
  /** The row's note, as the dry-run card prints it. */
  readonly note: string;
  /** The registered formula, with its inputs. */
  readonly formula: AppliedFormula;
}

/** An estimate, with its basis. */
export interface ReplayEstimate extends ReplayResultBase {
  readonly status: "estimate";
  /** The median wall time of the sample. */
  readonly estimateMs: number;
  /** The median absolute deviation of the sample — the card's `±`. */
  readonly spreadMs: number;
  /** How many samples the estimate rests on; at least the floor. */
  readonly sampleCount: number;
  /** Cache context for a build whose sample reported any; otherwise `null`. */
  readonly cache: CacheContext | null;
}

/** Too little history to say a number. */
export interface ReplayInsufficient extends ReplayResultBase {
  readonly status: "insufficient_history";
  /** How many samples were found — fewer than the floor. */
  readonly sampleCount: number;
  /** The floor they fell short of. */
  readonly sampleFloor: number;
}

/** What an estimator answers. */
export type ReplayResult = ReplayEstimate | ReplayInsufficient;

/** Raised by {@link assertCompleteEstimate}: a result that is not the whole answer. */
export class IncompleteEstimateError extends Error {
  /** @param missing - What the result lacks, or wrongly carries. */
  constructor(readonly missing: readonly string[]) {
    super(
      `A replay estimate must carry its whole basis; this one is wrong about: ${missing.join(", ")}.`,
    );
    this.name = "IncompleteEstimateError";
  }
}

/**
 * A duration as the dry-run card writes it — the same words as `replay_duration_label()` (V121).
 *
 * @param ms - Milliseconds; rounded to the second.
 * @returns `20s`, `4m 02s` or `1h 03m 20s`.
 */
export function durationLabel(ms: number): string {
  const seconds = Math.round(ms / 1000);
  const pad = (value: number): string => String(value).padStart(2, "0");

  if (seconds < 60) return `${String(seconds)}s`;
  if (seconds < 3600) return `${String(Math.floor(seconds / 60))}m ${pad(seconds % 60)}s`;

  return `${String(Math.floor(seconds / 3600))}h ${pad(Math.floor((seconds % 3600) / 60))}m ${pad(seconds % 60)}s`;
}

/**
 * What was sampled, in words.
 *
 * @param kind - What is estimated.
 * @param count - How many.
 * @returns `build` / `builds`, `test run` / `test runs`.
 */
function noun(kind: ReplayKind, count: number): string {
  const one = kind === "test" ? "test run" : "build";

  return count === 1 ? one : `${one}s`;
}

/**
 * A replayed row's note — the same words as `replay_estimate_note()` (V121).
 *
 * @param kind - What was estimated.
 * @param sampleCount - The samples the estimate rests on, or the count found below the floor.
 * @param estimate - The median and spread, or `null` for insufficient history.
 * @returns `est. 4m 02s (214 similar builds, ±20s)`, or the honest fallback naming the count.
 */
export function replayNote(
  kind: ReplayKind,
  sampleCount: number,
  estimate: { readonly estimateMs: number; readonly spreadMs: number } | null,
): string {
  const found = `${String(sampleCount)} similar ${noun(kind, sampleCount)}`;

  return estimate === null
    ? `insufficient history — the first real ${noun(kind, 1)} will measure this (${found} found)`
    : `est. ${durationLabel(estimate.estimateMs)} (${found}, ±${durationLabel(estimate.spreadMs)})`;
}

/**
 * The cache context of a build sample.
 *
 * @param sample - The halves, as the database counted them.
 * @returns The context, or `null` when no sampled build reported cache statistics.
 */
export function cacheContext(sample: CacheSample): CacheContext | null {
  if (sample.measured === 0) return null;

  const half = (count: number, medianMs: number | null): CacheHalf | null =>
    count > 0 && medianMs !== null ? { count, medianMs } : null;
  const warm = half(sample.warmCount, sample.warmMedianMs);
  const cold = half(sample.coldCount, sample.coldMedianMs);
  const words = (label: string, value: CacheHalf): string =>
    `${label} cache ≈ ${durationLabel(value.medianMs)} (${String(value.count)} ${noun("build", value.count)})`;

  return {
    measured: sample.measured,
    warm,
    cold,
    note: [warm === null ? null : words("warm", warm), cold === null ? null : words("cold", cold)]
      .filter((part) => part !== null)
      .join(" · "),
  };
}

/**
 * Decide what a sample may say.
 *
 * @param kind - What was sampled.
 * @param similarityClass - The class the sample was matched on, as printed.
 * @param sample - The statistics.
 * @param policy - The window read and the floor in force.
 * @param cache - The cache halves of a build sample; omitted for a test.
 * @returns An estimate when the sample reaches the floor, otherwise `insufficient_history` with
 *   the count found — never a number.
 */
export function composeEstimate(
  kind: ReplayKind,
  similarityClass: string,
  sample: ReplaySample,
  policy: ReplayPolicy,
  cache?: CacheSample,
): ReplayResult {
  const base = {
    kind,
    similarityClass,
    windowDays: policy.windowDays,
    formula: {
      ...replayFormula(kind),
      inputs: {
        similarityClass,
        windowDays: policy.windowDays,
        sampleFloor: policy.sampleFloor,
        sampleCount: sample.sampleCount,
      },
    },
  };

  if (
    sample.sampleCount < policy.sampleFloor ||
    sample.medianMs === null ||
    sample.spreadMs === null
  ) {
    return {
      ...base,
      status: "insufficient_history",
      sampleCount: sample.sampleCount,
      sampleFloor: policy.sampleFloor,
      note: replayNote(kind, sample.sampleCount, null),
    };
  }

  const estimate = { estimateMs: sample.medianMs, spreadMs: sample.spreadMs };

  return {
    ...base,
    ...estimate,
    status: "estimate",
    sampleCount: sample.sampleCount,
    cache: cache === undefined ? null : cacheContext(cache),
    note: replayNote(kind, sample.sampleCount, estimate),
  };
}

/**
 * Whether a value is a whole number of at least `least`.
 *
 * @param value - Anything.
 * @param least - The smallest value allowed.
 * @returns `true` for a safe integer at or above it.
 */
function wholeAtLeast(value: unknown, least: number): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= least;
}

/**
 * The probe: an estimate is its median, spread, sample count and window together, and
 * insufficient history is none of the numbers.
 *
 * Takes `unknown` on purpose — it is a check on what is about to leave the service, not on what
 * the types say should.
 *
 * @param result - The result to check.
 * @returns The same result, typed.
 * @throws {IncompleteEstimateError} Naming every part that is missing, malformed or — on an
 *   insufficient result — present when it must not be.
 */
export function assertCompleteEstimate(result: unknown): ReplayResult {
  const value = (result ?? {}) as Record<string, unknown>;
  const wrong: string[] = [];

  if (typeof value.similarityClass !== "string" || value.similarityClass.trim() === "") {
    wrong.push("similarityClass");
  }
  if (!wholeAtLeast(value.windowDays, 1)) wrong.push("windowDays");

  if (value.status === "estimate") {
    if (!wholeAtLeast(value.estimateMs, 0)) wrong.push("estimateMs");
    if (!wholeAtLeast(value.spreadMs, 0)) wrong.push("spreadMs");
    if (!wholeAtLeast(value.sampleCount, 1)) wrong.push("sampleCount");
  } else if (value.status === "insufficient_history") {
    if (!wholeAtLeast(value.sampleCount, 0)) wrong.push("sampleCount");
    if (!wholeAtLeast(value.sampleFloor, 1)) wrong.push("sampleFloor");
    if ("estimateMs" in value) wrong.push("estimateMs (a number without enough history)");
    if ("spreadMs" in value) wrong.push("spreadMs (a number without enough history)");
  } else {
    wrong.push("status");
  }

  if (wrong.length > 0) throw new IncompleteEstimateError(wrong);

  return result as ReplayResult;
}

/** What a replayed `dry_run_stages` row stores — `dry_run_stage_metrics_valid()` (V111, V121). */
export type ReplayStageMetrics =
  | {
      readonly estimate_ms: number;
      readonly spread_ms: number;
      readonly sample_count: number;
      readonly similarity_class: string;
      readonly window_days: number;
    }
  | {
      readonly insufficient_history: true;
      readonly sample_count: number;
      readonly similarity_class: string;
      readonly window_days: number;
    };

/** A result as the stage row that records it. */
export interface ReplayStageRecord {
  /** The row's `how` — always replayed. */
  readonly how: "replayed";
  /** The row's note. */
  readonly note: string;
  /** The row's metrics. */
  readonly metrics: ReplayStageMetrics;
}

/**
 * A result as the `dry_run_stages` row that records it.
 *
 * @param result - The estimator's answer.
 * @returns `how`, `note` and `metrics`, in the shape the table's CHECK accepts: the estimate
 *   with its sample, spread, class and window — or the insufficient marker with the count found
 *   and no number.
 */
export function replayStageRecord(result: ReplayResult): ReplayStageRecord {
  const basis = {
    sample_count: result.sampleCount,
    similarity_class: result.similarityClass,
    window_days: result.windowDays,
  };

  return {
    how: "replayed",
    note: result.note,
    metrics:
      result.status === "estimate"
        ? { estimate_ms: result.estimateMs, spread_ms: result.spreadMs, ...basis }
        : { insufficient_history: true, ...basis },
  };
}
