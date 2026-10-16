/**
 * Whether a run's branch may be pushed — the push grant's refusals, as one pure function (DI.2,
 * [#1310](https://github.com/NobuData/ouroboros/issues/1310)).
 *
 * Pure so that every refusal is table-tested without a database, and so the order is a fact of
 * one function rather than of a service's control flow. Everything here is decided from rows the
 * control plane already holds; **nothing here opens the credential or calls GitHub**. The one
 * refusal that needs the network — a protected branch — is the service's, and it runs only after
 * this function has let the request through.
 *
 * ```
 * 1  force_push_refused     the request asked for force
 * 2  branch_mismatch        branch ≠ runs.branch_name
 * 3  not_a_run_branch       the run's branch is not ouro/run-…
 * 4  default_branch         branch = github_repos.default_branch
 * 5  changes_not_evaluated  the change-set is not the run's latest, or a check is missing or pending
 * 6  guardrail_blocking     a latest check failed in block mode
 * 7  github_not_configured  the workspace has no GitHub token
 * ```
 *
 * **"Evaluated" means every check has judged this change-set.** The guardrail service (#305)
 * writes all four checks together on each non-empty change-set report, stamping the three
 * diff checks with the report's `change_set_seq`; `review_required` judges the policy, not the
 * diff, and carries no number. So a change-set is evaluated when the latest row of each of the
 * four exists, the three diff checks carry this change-set's number, and none is `pending`. A
 * `warn`-mode fail is shown and does not refuse (#315, AR.1 decision 1).
 */

import type { DomainError } from "../errors/error.envelope";
import type { GuardrailCheck, GuardrailMode, GuardrailVerdict } from "../db/schema";
import { GUARDRAIL_CHECKS } from "../db/schema";
import {
  branchMismatch,
  changesNotEvaluated,
  defaultBranch,
  forcePushRefused,
  githubNotConfigured,
  guardrailBlocking,
  notARunBranch,
} from "./run-push.errors";

/** The only branches Ouroboros pushes: `ouro/run-<run id>-<issue>` and its kin. */
export const RUN_BRANCH_PATTERN = /^ouro\/run-[A-Za-z0-9_-]+$/;

/** The one check that judges the policy rather than the diff, and so carries no change-set. */
const POLICY_CHECK: GuardrailCheck = "review_required";

/** One latest guardrail verdict, as `v_run_guardrails_latest` holds it. */
export interface LatestGuardrail {
  readonly check: GuardrailCheck;
  readonly verdict: GuardrailVerdict;
  readonly mode: GuardrailMode;
  /** The change-set the verdict judged; null for `review_required`. */
  readonly changeSetSeq: number | null;
}

/** Everything the refusals are decided from. */
export interface PushFacts {
  /** The branch the engine asked to push. */
  readonly branch: string;
  /** Whether the request asked for a force push. */
  readonly force: boolean;
  /** The change-set the engine says it is publishing. */
  readonly changeSetSeq: number;
  /** `runs.branch_name`. */
  readonly runBranch: string | null;
  /** `runs.change_set_seq` — the run's latest reported change-set. */
  readonly runChangeSetSeq: number;
  /** `github_repos.default_branch`, when known. */
  readonly defaultBranch: string | null;
  /** The run's latest verdict per check. */
  readonly guardrails: readonly LatestGuardrail[];
  /** Whether the workspace holds a GitHub token — asked, never opened. */
  readonly githubConfigured: boolean;
}

/**
 * The first refusal that applies, in the order above.
 *
 * @param facts - The request and the rows it is judged against.
 * @returns The error to throw, or `undefined` when nothing here refuses the push.
 */
export function pushRefusal(facts: PushFacts): DomainError | undefined {
  const { branch } = facts;

  if (facts.force) {
    return forcePushRefused(branch);
  }

  if (facts.runBranch === null || branch !== facts.runBranch) {
    return branchMismatch(branch, facts.runBranch);
  }

  if (!RUN_BRANCH_PATTERN.test(branch)) {
    return notARunBranch(branch);
  }

  if (facts.defaultBranch !== null && branch === facts.defaultBranch) {
    return defaultBranch(branch);
  }

  if (!evaluated(facts)) {
    return changesNotEvaluated(branch, facts.changeSetSeq, facts.runChangeSetSeq);
  }

  const blocking = GUARDRAIL_CHECKS.filter((check) =>
    facts.guardrails.some(
      (row) => row.check === check && row.verdict === "fail" && row.mode === "block",
    ),
  );

  if (blocking.length > 0) {
    return guardrailBlocking(branch, blocking);
  }

  if (!facts.githubConfigured) {
    return githubNotConfigured(branch);
  }

  return undefined;
}

/**
 * Whether every check has judged the change-set the push would publish.
 *
 * @param facts - The request and the verdicts.
 * @returns True when the change-set is the run's latest, at least one has been reported, and
 *   every check's latest verdict is present, settled and — for a diff check — about it.
 */
function evaluated(facts: PushFacts): boolean {
  if (facts.changeSetSeq < 1 || facts.changeSetSeq !== facts.runChangeSetSeq) {
    return false;
  }

  return GUARDRAIL_CHECKS.every((check) => {
    const row = facts.guardrails.find((candidate) => candidate.check === check);

    if (row === undefined || row.verdict === "pending") {
      return false;
    }

    return check === POLICY_CHECK || row.changeSetSeq === facts.changeSetSeq;
  });
}
