/**
 * The flake policy — which retries were **sanctioned**, and what a case's status is once the
 * unsanctioned ones are set aside (decision **T5**, AT.1
 * [#329](https://github.com/NobuData/ouroboros/issues/329)).
 *
 * A pass-on-retry is `flaky` **only** when the policy sanctioned that retry. An unsanctioned
 * re-execution is not evidence of flakiness — it is a harness re-running on its own — and
 * counting it would inflate every flake score in the system. So the attempts past the budget are
 * cut from `retry_outcomes`, the status is read from the last sanctioned attempt, and the cut
 * outcomes are kept in `meta.unsanctioned_outcomes` so nothing is silently lost.
 *
 * The workflow DSL has no `flakes:` key yet; the policy arrives as a parse input from whoever
 * triggers the parse (the upload manifest, #330), and defaults to {@link NO_RETRIES} — the
 * conservative reading, under which nothing is ever flaky.
 */

import type { TestAttemptOutcome, TestCaseStatus } from "../db/schema";

/** How many re-attempts after the first the pinned workflow sanctioned. */
export interface FlakePolicy {
  /** A whole number ≥ 0. */
  readonly sanctionedRetries: number;
}

/** No retry is sanctioned — the default when no policy is given. */
export const NO_RETRIES: FlakePolicy = Object.freeze({ sanctionedRetries: 0 });

/** The most retries a policy may sanction — the DSL's `max_retries` ceiling. */
export const MAX_SANCTIONED_RETRIES = 10;

/**
 * Read a policy as the DSL would spell it.
 *
 * @param spelling - `none`, `retry-once`, `retry-twice` or `retry-<n>` with 0 ≤ n ≤ 10.
 * @returns The policy.
 * @throws {RangeError} On any other spelling — a policy nobody can read must not become a default.
 */
export function parseFlakePolicy(spelling: string): FlakePolicy {
  const named: Record<string, number> = { none: 0, "retry-once": 1, "retry-twice": 2 };

  if (spelling in named) {
    return { sanctionedRetries: named[spelling] };
  }

  const match = /^retry-(\d{1,2})$/.exec(spelling);
  const n = match === null ? NaN : Number(match[1]);

  if (!Number.isInteger(n) || n > MAX_SANCTIONED_RETRIES) {
    throw new RangeError(`unknown flake policy ${JSON.stringify(spelling)}`);
  }

  return { sanctionedRetries: n };
}

/** A case's retry truth, ready for `test_cases`. */
export interface RetryTruth {
  /** Agrees with `outcomes` exactly as `test_case_outcomes_valid()` requires. */
  readonly status: TestCaseStatus;
  /** `outcomes.length - 1`. */
  readonly retries: number;
  /** The sanctioned attempts, in order. */
  readonly outcomes: readonly TestAttemptOutcome[];
  /** The attempts past the budget, in order — empty when there were none. */
  readonly unsanctioned: readonly TestAttemptOutcome[];
}

/**
 * Interpret a case's raw attempts against the policy.
 *
 * A `skipped` attempt among others is not an attempt that ran, so it is dropped; a case whose
 * every attempt was skipped is `["skipped"]` (V051: a case that never ran was never retried).
 *
 * @param raw - Every attempt's outcome, as the report gave them. Must not be empty.
 * @param policy - The sanctioned budget.
 * @returns The status, retries and outcomes to store.
 * @throws {RangeError} When `raw` is empty or the policy is not a whole number ≥ 0.
 */
export function applyFlakePolicy(
  raw: readonly TestAttemptOutcome[],
  policy: FlakePolicy,
): RetryTruth {
  if (raw.length === 0) {
    throw new RangeError("a case has at least one attempt");
  }
  if (!Number.isInteger(policy.sanctionedRetries) || policy.sanctionedRetries < 0) {
    throw new RangeError(`bad sanctioned retry count ${policy.sanctionedRetries}`);
  }

  const ran = raw.filter((outcome) => outcome !== "skipped");

  if (ran.length === 0) {
    return { status: "skipped", retries: 0, outcomes: ["skipped"], unsanctioned: [] };
  }

  const outcomes = ran.slice(0, policy.sanctionedRetries + 1);
  const unsanctioned = ran.slice(policy.sanctionedRetries + 1);

  return {
    status: statusOf(outcomes),
    retries: outcomes.length - 1,
    outcomes,
    unsanctioned,
  };
}

/**
 * The status a list of ran attempts gives — V051's table, read the other way.
 *
 * @param outcomes - Non-empty, no `skipped`.
 * @returns passed when all passed; flaky when the last passed after a failure; else the last.
 */
function statusOf(outcomes: readonly TestAttemptOutcome[]): TestCaseStatus {
  const last = outcomes[outcomes.length - 1];

  if (last !== "passed") {
    return last;
  }

  return outcomes.every((outcome) => outcome === "passed") ? "passed" : "flaky";
}
