/**
 * The four checks, as pure functions of what the service has read.
 *
 * AP.3 ([#305](https://github.com/NobuData/ouroboros/issues/305)), decision **R5**. Nothing here
 * reads or writes; `guardrails.repository.ts` gathers a {@link GuardrailInput} and this file turns
 * it into four verdicts. That split is what lets the rule matrix — every check × `pass` / `fail`
 * / `not_applicable` — be a table of inputs and expected rows rather than a database fixture per
 * cell.
 *
 * ---------------------------------------------------------------------------
 * **`not_applicable` means "there was no policy to judge against"**, uniformly:
 *
 * ```
 * allowed_paths    no plan file list declares a scope
 * ci_config        no model stage's touch_ci permission can be resolved from the pin
 * secrets          no file in the report carried diff hunks — nothing was scanned
 * review_required  review is not required: the pin auto-merges and no vote rule applies
 * ```
 *
 * The last is the mockup's `○ Human review not required (auto-merge eligible)`. The first three
 * are the same honesty V048 argues for: a check that did not run must not render as a tick.
 *
 * **`review_required`'s three answers.** The pinned workflow's terminal policy and the routing
 * vote rules are two statements about whether a person reviews the change:
 *
 * ```
 * terminal auto-merges   vote rule applies   verdict          meaning
 * yes                    no                  not_applicable   not required — auto-merge eligible
 * no                     either              pass             required, and the policy routes it to a person
 * yes                    yes                 fail             required, and the policy would merge without one
 * ```
 *
 * The fail is the dangerous row: an escalation rule asked for a second opinion and the terminal
 * would open the pull request with auto-merge anyway. A pin that cannot be read is also a
 * `fail`, because *"auto-merge eligible"* is not something to say about a policy nobody could
 * read.
 *
 * **A `fail` flags the run — it does not stop it.** The service reports every failing check to
 * its caller (`needsHuman` on the change-set answer), which is the `needs_human` interplay the
 * issue asks to be documented. Stopping the stage is enforcement, and enforcement needs an
 * executor to stop: that is AR.1 ([#315](https://github.com/NobuData/ouroboros/issues/315)).
 */

import type { GuardrailCheck, GuardrailEvidence, GuardrailVerdict } from "../db/schema";
import { CI_CONFIG_GLOBS, CI_REGISTRY_VERSION, ciConfigGlob } from "./guardrails.ci";
import { safeEvidence } from "./guardrails.evidence";
import { GlobSet, nearestGlob, widenToScope } from "./guardrails.glob";
import { SECRETS_RULESET_VERSION } from "./guardrails.ruleset";
import { scanChangeSet, type ScannedFile } from "./guardrails.secrets";

/** The pinned stage's permissions, as far as the checks read them. */
export interface StagePermissions {
  /** The DSL node id the permissions came from, for evidence. */
  readonly stageKey: string;
  /** `permissions.touch_ci`. */
  readonly touchCi: boolean;
}

/** The pinned workflow's policy, as far as `review_required` reads it. */
export interface ReviewPolicy {
  /** Whether any terminal of the pinned document is `open_pr_automerge`. */
  readonly autoMerges: boolean;
  /** How many enabled escalation rules add a review vote for this run's ticket. */
  readonly voteRules: number;
}

/** Everything the four checks judge. */
export interface GuardrailInput {
  /** The report being judged. */
  readonly changeSetSeq: number;
  /** The change-set: every reported path, with its hunks where the report carried them. */
  readonly files: readonly ScannedFile[];
  /**
   * The plan's declared file list — `issue_estimates.breakdown.files` — or `undefined` when the
   * run's ticket has no estimate.
   */
  readonly planFiles?: readonly string[];
  /** The pinned stage's permissions, or `undefined` when none can be resolved. */
  readonly permissions?: StagePermissions;
  /** The pinned policy, or `undefined` when the pinned document could not be read. */
  readonly review?: ReviewPolicy;
}

/** One verdict, ready for `guardrail_evaluations` — minus the run and the policy reference. */
export interface GuardrailVerdictRow {
  readonly check: GuardrailCheck;
  readonly verdict: Exclude<GuardrailVerdict, "pending">;
  /** Already screened by {@link safeEvidence}. */
  readonly evidence: GuardrailEvidence | null;
  readonly rulesetVersion: string | null;
  /** The report's number, or `null` for `review_required`, which is not about a change-set. */
  readonly changeSetSeq: number | null;
}

/**
 * Pluralise a count for a detail sentence.
 *
 * @param count - How many.
 * @param noun - The singular noun.
 * @returns `"1 path"`, `"3 paths"`.
 */
function counted(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * `allowed_paths` — is every reported path inside the pinned stage's scope?
 *
 * The scope is the plan's declared files widened to their directories (`widenToScope`), plus the
 * CI registry when the stage may touch CI — so a permitted CI edit is judged once, by
 * `ci_config`, rather than failing here as well.
 *
 * @param input - The change-set and the policy.
 * @returns The verdict. A failure names the first offending path, in code-unit order, and the
 *   scope glob it came closest to.
 */
export function checkAllowedPaths(input: GuardrailInput): GuardrailVerdictRow {
  const declared = widenToScope(input.planFiles ?? []);
  const base = {
    check: "allowed_paths" as const,
    rulesetVersion: null,
    changeSetSeq: input.changeSetSeq,
  };

  if (declared.length === 0) {
    return {
      ...base,
      verdict: "not_applicable",
      evidence: safeEvidence({ detail: "No plan file list declares a scope for this run." }),
    };
  }

  const scope = new GlobSet(
    input.permissions?.touchCi === true ? [...declared, ...CI_CONFIG_GLOBS] : declared,
  );
  const outside = input.files
    .map((file) => file.path)
    .filter((path) => !scope.matches(path))
    .sort();

  if (outside.length === 0) {
    return { ...base, verdict: "pass", evidence: null };
  }

  return {
    ...base,
    verdict: "fail",
    evidence: safeEvidence({
      path: outside[0],
      glob: nearestGlob(outside[0], declared),
      detail: `${counted(outside.length, "path")} outside the declared scope.`,
    }),
  };
}

/**
 * `ci_config` — does the change-set touch CI configuration the stage may not touch?
 *
 * @param input - The change-set and the stage's permissions.
 * @returns The verdict, recording the CI registry's version whenever the registry was consulted.
 */
export function checkCiConfig(input: GuardrailInput): GuardrailVerdictRow {
  const base = { check: "ci_config" as const, changeSetSeq: input.changeSetSeq };

  if (input.permissions === undefined) {
    return {
      ...base,
      verdict: "not_applicable",
      rulesetVersion: null,
      evidence: safeEvidence({
        detail: "The pinned workflow declares no model stage whose touch_ci permission applies.",
      }),
    };
  }

  const touched = input.files
    .map((file) => ({ path: file.path, glob: ciConfigGlob(file.path) }))
    .filter((entry): entry is { path: string; glob: string } => entry.glob !== undefined)
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  if (touched.length === 0) {
    return { ...base, verdict: "pass", rulesetVersion: CI_REGISTRY_VERSION, evidence: null };
  }

  const { stageKey, touchCi } = input.permissions;

  return {
    ...base,
    verdict: touchCi ? "pass" : "fail",
    rulesetVersion: CI_REGISTRY_VERSION,
    evidence: safeEvidence({
      path: touched[0].path,
      glob: touched[0].glob,
      detail: touchCi
        ? `${counted(touched.length, "CI file")} touched, permitted by touch_ci on stage ${stageKey}.`
        : `${counted(touched.length, "CI file")} touched while touch_ci is false on stage ${stageKey}.`,
    }),
  };
}

/**
 * `secrets` — does any added line match the embedded ruleset?
 *
 * @param input - The change-set, with its hunks.
 * @returns The verdict. A failure names the first finding's path, line and rule id — never the
 *   matched text, which {@link scanChangeSet} does not return.
 */
export function checkSecrets(input: GuardrailInput): GuardrailVerdictRow {
  const base = { check: "secrets" as const, changeSetSeq: input.changeSetSeq };
  const scan = scanChangeSet(input.files);

  if (!scan.scanned) {
    return {
      ...base,
      verdict: "not_applicable",
      rulesetVersion: null,
      evidence: safeEvidence({ detail: "No diff hunks were reported, so nothing was scanned." }),
    };
  }

  if (scan.findings.length === 0) {
    return { ...base, verdict: "pass", rulesetVersion: SECRETS_RULESET_VERSION, evidence: null };
  }

  const first = scan.findings[0];
  const files = new Set(scan.findings.map((finding) => finding.path)).size;

  return {
    ...base,
    verdict: "fail",
    rulesetVersion: SECRETS_RULESET_VERSION,
    evidence: safeEvidence({
      path: first.path,
      line: first.line,
      rule_id: first.ruleId,
      detail: `${counted(scan.findings.length, "finding")} in ${counted(files, "file")}.`,
    }),
  };
}

/**
 * `review_required` — does a person have to review this run's change before it merges?
 *
 * @param input - The pinned policy.
 * @returns The verdict, per the table in this file's header. `change_set_seq` is null: the
 *   answer is a property of the policy and the ticket, not of any one report.
 */
export function checkReviewRequired(input: GuardrailInput): GuardrailVerdictRow {
  const base = { check: "review_required" as const, rulesetVersion: null, changeSetSeq: null };
  const review = input.review;

  if (review === undefined) {
    return {
      ...base,
      verdict: "fail",
      evidence: safeEvidence({
        detail: "The pinned workflow policy could not be read, so auto-merge cannot be assumed.",
      }),
    };
  }

  if (!review.autoMerges) {
    return {
      ...base,
      verdict: "pass",
      evidence: safeEvidence({
        detail: "Review required: the terminal policy routes this run to a person.",
      }),
    };
  }

  if (review.voteRules === 0) {
    return { ...base, verdict: "not_applicable", evidence: null };
  }

  return {
    ...base,
    verdict: "fail",
    evidence: safeEvidence({
      detail: `Review required by ${counted(review.voteRules, "escalation vote rule")}, but the terminal policy auto-merges.`,
    }),
  };
}

/**
 * Run all four checks.
 *
 * @param input - Everything they judge.
 * @returns One verdict per check, in the card's order.
 */
export function evaluateGuardrails(input: GuardrailInput): GuardrailVerdictRow[] {
  return [
    checkAllowedPaths(input),
    checkCiConfig(input),
    checkSecrets(input),
    checkReviewRequired(input),
  ];
}
