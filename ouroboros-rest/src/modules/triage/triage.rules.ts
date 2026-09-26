/**
 * The heuristic triage hints — option **5-A** of AT.4
 * ([#332](https://github.com/NobuData/ouroboros/issues/332)).
 *
 * **Rules, not intelligence.** The Mark & Route card pre-selects a radio and labels it
 * `heuristic`; what picked it is one of the three deterministic rules below, and a person can
 * read the rule and disagree with it. A hint never carries a confidence: a rule that reported
 * *"84%"* would be inventing a calibration it does not have, and V055's
 * `failure_classifications_confidence_model_only` (and `schemas/triage/v0.json`) refuse one.
 *
 * ```
 * rule                          suggests      fires when
 * flake.pass_on_retry           flake_retry   the case passed on a sanctioned retry in this attempt,
 *                                             or an earlier occurrence of its case_key did
 * infra.rig_error               infra_rig     the attempt's build was retried for infrastructure,
 *                                             its runner is offline or removed, or the failure text
 *                                             matches the infra taxonomy below
 * product.new_failure_in_diff   product_bug   the case did not fail in the previous attempt AND the
 *                                             failure's path is (or sits beside) a path the run changed
 * ```
 *
 * The rules are evaluated in that order and the **first** that fires is the hint; every rule's
 * verdict and reason is returned too, so the card can show why the others did not fire. The
 * order is a precedence: a case that passed on retry is a flake whatever else is true of it, and
 * a rig that browned out explains a failure better than a diff does.
 *
 * Everything here is pure. `triage.repository.ts` gathers a {@link HintContext}; this decides.
 */

import type {
  BuildJobStatus,
  FailureClass,
  RunnerStatus,
  TestAttemptOutcome,
  TestCaseFailure,
  TestCaseStatus,
} from "../db/schema";

/** The three rules, by id — what `failure_classifications.rule_id` records for a heuristic. */
export const HINT_RULES = {
  passOnRetry: "flake.pass_on_retry",
  rigError: "infra.rig_error",
  newFailureInDiff: "product.new_failure_in_diff",
} as const;

/** One of {@link HINT_RULES}. */
export type HintRuleId = (typeof HINT_RULES)[keyof typeof HINT_RULES];

/**
 * The infra error taxonomy: failure text that names the rig or the machine rather than the
 * code. Each entry has an id, so the reason a hint gives names the pattern that matched.
 * Matched case-insensitively against the failure's message and log excerpt.
 */
export const INFRA_TAXONOMY: readonly { readonly id: string; readonly pattern: RegExp }[] = [
  {
    id: "rig_offline",
    pattern:
      /\b(rig|device|board|target|dut)\b[^\n]{0,40}\b(offline|unreachable|not responding|disconnected)\b/i,
  },
  { id: "power", pattern: /\b(brown-?out|power (loss|lost|cycle failed)|under-?voltage)\b/i },
  {
    id: "connection",
    pattern: /\b(ECONNREFUSED|ECONNRESET|ETIMEDOUT|connection (refused|reset|timed out))\b/i,
  },
  {
    id: "probe",
    pattern:
      /\b(no such device|serial port\b[^\n]{0,40}\b(busy|not found)|probe (not found|failed))\b/i,
  },
  {
    id: "runner_lost",
    pattern: /\b((runner|agent) (lost|disconnected)|no space left on device|out of disk)\b/i,
  },
];

/** What the rules read about one failing case. */
export interface HintContext {
  /** The case itself. */
  readonly status: TestCaseStatus;
  readonly retryOutcomes: readonly TestAttemptOutcome[];
  readonly failure: TestCaseFailure | null;
  /**
   * Earlier occurrences of the same `case_key` in the workspace that passed on a retry
   * (`test_case_history.pass_on_retry`), not counting this one.
   */
  readonly priorPassOnRetry: number;
  /** The build that produced the attempt, when there was one. */
  readonly job: {
    readonly status: BuildJobStatus;
    /** The status of the runner that held it, or null when none did. */
    readonly runnerStatus: RunnerStatus | null;
  } | null;
  /**
   * The same `case_key` in the previous attempt of the run: its status, `"absent"` when it did
   * not run there, or null when this is the run's first attempt (nothing to compare with).
   */
  readonly previous: TestCaseStatus | "absent" | null;
  /** Every path the run changed (`run_files`). */
  readonly changedPaths: readonly string[];
}

/** One rule's verdict on one case. */
export interface RuleVerdict {
  readonly ruleId: HintRuleId;
  readonly suggests: FailureClass;
  readonly fired: boolean;
  /** Why it did or did not fire, in a sentence the card can show. */
  readonly reason: string;
}

/**
 * A heuristic hint — the shape the issue fixes: a class, the rule, **`confidence: null`** and
 * the `heuristic` actor.
 */
export interface Hint {
  readonly suggestedClass: FailureClass;
  readonly ruleId: HintRuleId;
  readonly confidence: null;
  readonly actor: "heuristic";
  readonly reason: string;
}

/** Every rule's verdict, and the hint (the first that fired) or null. */
export interface HintEvaluation {
  readonly hint: Hint | null;
  readonly rules: readonly RuleVerdict[];
}

/**
 * Evaluate the three rules over one case.
 *
 * @param context - What the rules read.
 * @returns Every verdict, in precedence order, and the hint.
 */
export function evaluateHints(context: HintContext): HintEvaluation {
  const rules = [passOnRetry(context), rigError(context), newFailureInDiff(context)];
  const first = rules.find((rule) => rule.fired);

  return {
    hint:
      first === undefined
        ? null
        : {
            suggestedClass: first.suggests,
            ruleId: first.ruleId,
            confidence: null,
            actor: "heuristic",
            reason: first.reason,
          },
    rules,
  };
}

/**
 * `flake.pass_on_retry` — a sanctioned pass on retry, now or in the case's history.
 *
 * @param context - The case.
 * @returns The verdict.
 */
function passOnRetry(context: HintContext): RuleVerdict {
  const verdict = (fired: boolean, reason: string): RuleVerdict => ({
    ruleId: HINT_RULES.passOnRetry,
    suggests: "flake_retry",
    fired,
    reason,
  });

  if (context.status === "flaky") {
    const at = context.retryOutcomes.indexOf("passed");

    return verdict(true, `Passed on retry ${at + 1} of ${context.retryOutcomes.length}.`);
  }

  if (context.priorPassOnRetry > 0) {
    return verdict(
      true,
      `Passed on a retry in ${context.priorPassOnRetry} earlier ${plural(context.priorPassOnRetry, "occurrence")}.`,
    );
  }

  return verdict(false, "Never passed on a retry, here or in its history.");
}

/**
 * `infra.rig_error` — the job, the runner or the failure text points at infrastructure.
 *
 * @param context - The case.
 * @returns The verdict.
 */
function rigError(context: HintContext): RuleVerdict {
  const verdict = (fired: boolean, reason: string): RuleVerdict => ({
    ruleId: HINT_RULES.rigError,
    suggests: "infra_rig",
    fired,
    reason,
  });

  if (context.job?.status === "retried") {
    return verdict(true, "The build was retried by dispatch for an infrastructure failure.");
  }

  if (context.job?.runnerStatus === "offline" || context.job?.runnerStatus === "removed") {
    return verdict(true, `The runner that ran it is ${context.job.runnerStatus}.`);
  }

  const text = [context.failure?.message, context.failure?.log_excerpt]
    .filter((part): part is string => typeof part === "string")
    .join("\n");
  const match = INFRA_TAXONOMY.find((entry) => entry.pattern.test(text));

  if (match !== undefined) {
    return verdict(true, `The failure reads as infrastructure (${match.id}).`);
  }

  return verdict(false, "Nothing in the job, the runner or the failure names infrastructure.");
}

/**
 * `product.new_failure_in_diff` — new since the previous attempt, and in code the run changed.
 *
 * @param context - The case.
 * @returns The verdict.
 */
function newFailureInDiff(context: HintContext): RuleVerdict {
  const verdict = (fired: boolean, reason: string): RuleVerdict => ({
    ruleId: HINT_RULES.newFailureInDiff,
    suggests: "product_bug",
    fired,
    reason,
  });

  if (context.status === "flaky") {
    return verdict(false, "It passed in the end, so it is not a failure to attribute.");
  }

  if (context.previous === null) {
    return verdict(false, "This is the run's first attempt, so there is nothing to compare with.");
  }

  if (context.previous === "failed" || context.previous === "error") {
    return verdict(false, "It already failed in the previous attempt.");
  }

  const path = context.failure?.path;

  if (path === undefined || path === "") {
    return verdict(false, "The failure names no path to compare with the diff.");
  }

  const overlap = overlappingPath(path, context.changedPaths);

  if (overlap === undefined) {
    return verdict(false, `New since the previous attempt, but ${path} is outside the diff.`);
  }

  return verdict(
    true,
    overlap === path
      ? `New since the previous attempt, in ${path}, which this run changed.`
      : `New since the previous attempt, beside ${overlap}, which this run changed.`,
  );
}

/**
 * The changed path a failure's path overlaps: the same file, or a file in the same directory.
 *
 * @param path - The failure's path.
 * @param changed - The run's changed paths.
 * @returns The overlapping changed path, preferring an exact match, or undefined.
 */
export function overlappingPath(path: string, changed: readonly string[]): string | undefined {
  const normalized = normalize(path);

  if (changed.some((candidate) => normalize(candidate) === normalized)) return path;

  const directory = directoryOf(normalized);

  return directory === ""
    ? undefined
    : changed.find((candidate) => directoryOf(normalize(candidate)) === directory);
}

/**
 * A repository-relative path without a leading `./`.
 *
 * @param path - A path.
 * @returns It, normalized.
 */
function normalize(path: string): string {
  return path.replace(/^\.\//, "");
}

/**
 * The directory part of a path, or `""` for a file at the root.
 *
 * @param path - A normalized path.
 * @returns Its directory.
 */
function directoryOf(path: string): string {
  const slash = path.lastIndexOf("/");

  return slash < 0 ? "" : path.slice(0, slash);
}

/**
 * A count's noun.
 *
 * @param count - How many.
 * @param noun - The singular.
 * @returns The singular or an `s` plural.
 */
function plural(count: number, noun: string): string {
  return count === 1 ? noun : `${noun}s`;
}
