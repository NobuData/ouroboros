/**
 * The registered formulas of the replay estimators (CD.3,
 * [#561](https://github.com/NobuData/ouroboros/issues/561)).
 *
 * A dry run's `est. 4m 02s (214 similar builds, ±20s)` has a popover, and the popover must explain
 * the arithmetic that actually ran rather than paraphrase it. So each estimator **declares** its
 * computation here, in the shape the metrics plane's registry already uses
 * (`metric_definitions`, #432: an id, a version, a title, the formula in words, the planes it
 * reads and its caveats), and every estimate carries its formula with the real inputs filled in
 * (`replay.estimate.ts`).
 *
 * The arithmetic itself is the database's — `build_replay_sample()` and `test_replay_sample()`
 * (V121) — so that the dev seed's replayed row is the same computation. **A change to what either
 * function computes raises the version here**, which is what tells a stored estimate's reader
 * that the popover no longer describes it.
 */

/** What an estimator samples. */
export type ReplayKind = "build" | "test";

/** The dispersion measure every replay estimate's `±` is. */
export const REPLAY_DISPERSION = "median_absolute_deviation";

/** One estimator's declared computation. */
export interface ReplayFormula {
  /** The formula's id — stable, and what a stored estimate names. */
  readonly id: string;
  /** Raised whenever the computation changes. */
  readonly version: number;
  /** What the figure is, as a popover heading. */
  readonly title: string;
  /** The computation, in words a reader can check against the inputs. */
  readonly formulaText: string;
  /** The planes whose history it reads. */
  readonly sourcePlanes: readonly string[];
  /** What the figure does not say. */
  readonly caveats: string;
  /** The estimate's unit. */
  readonly unit: "duration_ms";
  /** What the `±` is. */
  readonly dispersion: typeof REPLAY_DISPERSION;
}

/** The registry, by kind. */
export const REPLAY_FORMULAS: Readonly<Record<ReplayKind, ReplayFormula>> = {
  build: {
    id: "build_duration_replay",
    version: 1,
    title: "Estimated build duration",
    formulaText:
      "The median start-to-finish wall time of the succeeded build-farm jobs in the window " +
      "that share this stage's similarity class: the same workspace, repository, pool, " +
      "executor and configuration class (the container image without its tag, plus the " +
      "command). The ± is the median absolute deviation: the median distance of those " +
      "builds from the median. Fewer builds than the sample floor is insufficient history, " +
      "and no number is given.",
    sourcePlanes: ["build_farm"],
    caveats:
      "An estimate from history, not a measurement: the dry run builds nothing. Failed, " +
      "retried and cancelled builds are not counted. A cold-cache build runs longer than " +
      "the median; the warm and cold builds in the sample are counted separately as context.",
    unit: "duration_ms",
    dispersion: REPLAY_DISPERSION,
  },
  test: {
    id: "test_duration_replay",
    version: 1,
    title: "Estimated test duration",
    formulaText:
      "The median wall time of this repository's complete test runs in the window that " +
      "reported exactly this suite set. The ± is the median absolute deviation: the median " +
      "distance of those runs from the median. Fewer runs than the sample floor is " +
      "insufficient history, and no number is given.",
    sourcePlanes: ["test_results"],
    caveats:
      "An estimate from test history, not from build history and not a measurement: the dry " +
      "run runs no tests. Runs driven by a simulator, runs still in flight and runs that " +
      "reported a different suite set are not counted.",
    unit: "duration_ms",
    dispersion: REPLAY_DISPERSION,
  },
};

/**
 * The formula an estimator of a kind declares.
 *
 * @param kind - What is estimated.
 * @returns Its registered formula.
 */
export function replayFormula(kind: ReplayKind): ReplayFormula {
  return REPLAY_FORMULAS[kind];
}
