/**
 * The bisect's search, as arithmetic over its checkpoint — no database, no farm (CL.4,
 * [#617](https://github.com/NobuData/ouroboros/issues/617)).
 *
 * The candidates are `commits[0..n-1]`, oldest first: every commit after the good one, up to and
 * including the bad one. The culprit — the first commit that builds bad — is always inside the
 * window `lo..hi`. A step builds the middle of the window: good moves `lo` past it, bad moves `hi`
 * onto it. When the window is one commit wide, that commit is the culprit.
 *
 * ```
 * n = 6   [c2 c3 c4 c5 c6 c7]   lo=0 hi=5   build c4 (2) → bad    hi=2
 *         [c2 c3 c4]            lo=0 hi=2   build c3 (1) → good   lo=2   ⇒ culprit c4
 * ```
 *
 * That takes ⌈log₂ n⌉ steps, within the bound ⌊log₂ n⌋ + 1. The one exception is a line of one
 * commit: nothing would be built at all, so the single candidate is built once to confirm it —
 * a culprit is cited with the jobs that proved it, and zero jobs prove nothing. If it builds good,
 * the bisect is **inconclusive** (the bad commit was not bad when built), never a guess.
 */

/** Where a bisect stands. */
export interface BisectWindow {
  /** The first candidate the culprit may be. */
  readonly lo: number;
  /** The last — it built bad, or is the bad commit itself. */
  readonly hi: number;
  /** Steps already taken. */
  readonly steps: number;
  /** ⌊log₂ n⌋ + 1. */
  readonly maxSteps: number;
}

/** What to do next. */
export type BisectMove =
  | { readonly kind: "build"; readonly candidate: number }
  | { readonly kind: "converged"; readonly culprit: number }
  | { readonly kind: "exhausted" };

/** A step's verdict. */
export type Verdict = "good" | "bad";

/** A window after a verdict, or the end of the search. */
export type AppliedVerdict =
  | { readonly kind: "window"; readonly lo: number; readonly hi: number }
  | { readonly kind: "inconclusive" };

/**
 * The step bound for a line.
 *
 * @param candidates - How many commits could be the culprit.
 * @returns ⌊log₂ n⌋ + 1.
 */
export function maxSteps(candidates: number): number {
  return Math.floor(Math.log2(Math.max(1, candidates))) + 1;
}

/**
 * The next move from a window.
 *
 * @param window - The checkpoint and the steps taken.
 * @returns Build a candidate, name the culprit, or — only if the arithmetic were broken —
 *   `exhausted` rather than a step past the bound.
 */
export function nextMove(window: BisectWindow): BisectMove {
  const { lo, hi, steps } = window;

  if (lo === hi) {
    // A one-commit line has proven nothing yet: build it once.
    if (steps === 0) return guarded(window, lo);
    return { kind: "converged", culprit: lo };
  }
  return guarded(window, Math.floor((lo + hi) / 2));
}

/**
 * A build, unless the bound is spent.
 *
 * @param window - The checkpoint.
 * @param candidate - What to build.
 * @returns The move.
 */
function guarded(window: BisectWindow, candidate: number): BisectMove {
  return window.steps >= window.maxSteps ? { kind: "exhausted" } : { kind: "build", candidate };
}

/**
 * The window after a step's verdict.
 *
 * @param window - The checkpoint before it.
 * @param candidate - What the step built.
 * @param verdict - What its job said.
 * @returns The narrowed window; `inconclusive` when the only candidate built good.
 */
export function applyVerdict(
  window: Pick<BisectWindow, "lo" | "hi">,
  candidate: number,
  verdict: Verdict,
): AppliedVerdict {
  if (verdict === "bad") return { kind: "window", lo: window.lo, hi: candidate };
  if (candidate >= window.hi) return { kind: "inconclusive" };
  return { kind: "window", lo: candidate + 1, hi: window.hi };
}
