/**
 * The derived numbers of the Test Results page — computed here, once, so no client re-derives
 * them (AT.5, [#333](https://github.com/NobuData/ouroboros/issues/333)).
 *
 * ```
 * Passed 61 · ▲ 12 vs build 1     passedDelta()       the last earlier attempt whose count differs
 * Next · gated on 63/63           activationState()   decision T8: gate armed, intent stored, or none
 * artifacts · retained 30d        retentionDays()     retained_until − created_at, in whole days
 * ```
 *
 * **Why "the last earlier attempt whose count differs"** rather than the attempt just before.
 * Mockup 11's Build 3 re-ran Build 2's failed set and carried its 61 passes forward, so against
 * Build 2 it is `▲ 0` — true, and useless. The strip's delta says how far the loop has moved the
 * count, and names the attempt it measured against, so the label is never the mockup's
 * `vs build 2` when the number is Build 1's (#328's decision 2). An attempt that has reported no
 * case yet is nobody's baseline, and has none itself.
 *
 * Everything here is pure: rows in, figures out.
 */

/** The five counts of an attempt, recounted from its cases (V051). */
export interface AttemptCounts {
  readonly total: number;
  readonly passed: number;
  /** Cases with status `failed` or `error`. */
  readonly failed: number;
  readonly flaky: number;
  readonly skipped: number;
}

/** What {@link passedDelta} reads of an attempt. */
export interface DeltaAttempt {
  readonly id: string;
  readonly attemptSeq: number;
  readonly counts: AttemptCounts;
}

/** `▲ 12 vs build 1` — the change in passed cases, and the attempt it is measured against. */
export interface PassedDelta {
  /** Passed now minus passed then. Never zero: an equal count is skipped, not compared. */
  readonly value: number;
  readonly versusAttemptSeq: number;
  readonly versusTestRunId: string;
}

/**
 * The change in passed cases since the count last moved.
 *
 * @param attempts - Every attempt of the run, in any order.
 * @param testRunId - The attempt the strip is for.
 * @returns The delta against the most recent earlier attempt (by `attemptSeq`) that reported
 *   cases and passed a different number of them; null when the attempt reported nothing, is not
 *   in the list, or no earlier attempt differs.
 */
export function passedDelta(
  attempts: readonly DeltaAttempt[],
  testRunId: string,
): PassedDelta | null {
  const current = attempts.find((attempt) => attempt.id === testRunId);
  if (current === undefined || current.counts.total === 0) return null;

  const baseline = attempts
    .filter(
      (attempt) =>
        attempt.attemptSeq < current.attemptSeq &&
        attempt.counts.total > 0 &&
        attempt.counts.passed !== current.counts.passed,
    )
    .reduce<DeltaAttempt | undefined>(
      (latest, attempt) =>
        latest === undefined || attempt.attemptSeq > latest.attemptSeq ? attempt : latest,
      undefined,
    );

  if (baseline === undefined) return null;

  return {
    value: current.counts.passed - baseline.counts.passed,
    versusAttemptSeq: baseline.attemptSeq,
    versusTestRunId: baseline.id,
  };
}

/**
 * Decision **T8**'s activation state of the *Next* card:
 *
 * | State | When | The card says |
 * |---|---|---|
 * | `gate_armed` | the run's PR carries a required `test_suite` gate, which the gate engine (#358) evaluates on every revision | *Publish to PR #514 when green · gated on 63/63* |
 * | `intent_stored` | *Block PR until green* is on, but no PR carries the gate yet | the intent, labelled with its activation point |
 * | `none` | neither | nothing is waiting on green |
 */
export type ActivationState = "gate_armed" | "intent_stored" | "none";

/**
 * Which T8 state the run's next step is in.
 *
 * @param blockUntilGreen - `run_pr_intents.block_until_green`; false when the run has no row.
 * @param gateRequired - Whether the run's PR's `test_suite` gate definition is required; null
 *   when there is no PR or it has no such gate.
 * @returns The state. An armed gate wins over the intent, since it is what actually holds.
 */
export function activationState(
  blockUntilGreen: boolean,
  gateRequired: boolean | null,
): ActivationState {
  if (gateRequired === true) return "gate_armed";
  return blockUntilGreen ? "intent_stored" : "none";
}

/** One day, in milliseconds. */
const DAY_MS = 86_400_000;

/**
 * How long an artifact is kept — the card's `retained 30d`, from the row rather than from
 * configuration, so it states the policy the file was uploaded under.
 *
 * @param createdAt - When it was uploaded.
 * @param retainedUntil - When the sweep may take it.
 * @returns Whole days, rounded to the nearest.
 */
export function retentionDays(createdAt: Date, retainedUntil: Date): number {
  return Math.round((retainedUntil.getTime() - createdAt.getTime()) / DAY_MS);
}
