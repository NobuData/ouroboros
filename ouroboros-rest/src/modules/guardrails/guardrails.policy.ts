/**
 * The pinned workflow and the routing rules, read as the facts the checks need — and nothing
 * else.
 *
 * AP.3 ([#305](https://github.com/NobuData/ouroboros/issues/305)) judges a change-set against
 * *"the run's pinned policy"*, and the pinned policy is three things stored in three places:
 *
 * ```
 * stage permissions   workflow_versions.definition → llm node → config.permissions   (WF-P.2, #133)
 * terminal policy     workflow_versions.definition → term nodes → config.action
 * vote rules          escalation_rules where "then" is add_vote, matched against the ticket
 * ```
 *
 * Like `ingest/ingest.pin.ts`, this **reads** rather than validates: a stored version passed the
 * publish gate, and re-validating it here could refuse a verdict against a document the studio
 * accepted under an earlier rule. A node this reader cannot parse is skipped, and a document it
 * cannot parse at all yields `undefined` — which the checks turn into an honest answer rather than
 * a `500`.
 *
 * **Which stage's permissions.** The change-set was written by a model stage, and the one that
 * wrote it is the model stage the run most recently reported (`run_stages`, newest first). A run
 * that has reported no model stage yet — an executor may report files before its first
 * transition — is judged against the **most restrictive** model stage in the document: `touch_ci`
 * is true only if every model stage allows it. Guessing the permissive stage would let a report
 * that arrives early pass a check the stage that actually wrote it would fail.
 */

import type { EscalationThen, EscalationWhen, QueueEffort } from "../db/schema";
import { matchesPredicate, type ResolutionContext } from "../routing/context";
import { NodeShapeSchema, WorkflowRootSchema } from "../workflows/dsl.schema";
import type { ReviewPolicy, StagePermissions } from "./guardrails.checks";

/** What the pinned document says, as far as the checks read it. */
export interface PinnedPolicy {
  /** Every model stage's `touch_ci`, by node id, in document order. */
  readonly touchCi: ReadonlyMap<string, boolean>;
  /** Whether any terminal is `open_pr_automerge`. */
  readonly autoMerges: boolean;
}

/**
 * Read a stored workflow definition into the policy facts.
 *
 * @param definition - `workflow_versions.definition`, as the database returns it.
 * @returns The facts, or `undefined` when the document is not a workflow document at all.
 */
export function readPinnedPolicy(definition: unknown): PinnedPolicy | undefined {
  const root = WorkflowRootSchema.safeParse(definition);

  if (!root.success) {
    return undefined;
  }

  const touchCi = new Map<string, boolean>();
  let autoMerges = false;

  for (const candidate of root.data.nodes) {
    const node = NodeShapeSchema.safeParse(candidate);

    if (!node.success) {
      continue;
    }

    const { id, type, config } = node.data;

    if (type === "llm") {
      const permissions = config.permissions;

      if (typeof permissions === "object" && permissions !== null) {
        const flag = (permissions as Record<string, unknown>).touch_ci;

        if (typeof flag === "boolean") {
          touchCi.set(id, flag);
        }
      }
    } else if (type === "term" && config.action === "open_pr_automerge") {
      autoMerges = true;
    }
  }

  return { touchCi, autoMerges };
}

/**
 * Resolve which model stage's permissions the change-set is judged against.
 *
 * @param policy - The pinned policy.
 * @param reportedStages - The stage keys the run has reported, most recent first.
 * @returns The most recently reported model stage's permissions; failing that, the most
 *   restrictive model stage's; or `undefined` when the document has no model stage with
 *   permissions at all.
 */
export function resolvePermissions(
  policy: PinnedPolicy,
  reportedStages: readonly string[],
): StagePermissions | undefined {
  for (const stageKey of reportedStages) {
    const touchCi = policy.touchCi.get(stageKey);

    if (touchCi !== undefined) {
      return { stageKey, touchCi };
    }
  }

  // Nothing reported yet: the most restrictive stage speaks. The first stage that forbids CI
  // is named, because that is the permission the verdict is actually applying.
  for (const [stageKey, touchCi] of policy.touchCi) {
    if (!touchCi) {
      return { stageKey, touchCi };
    }
  }

  const first = policy.touchCi.keys().next();

  return first.done === true ? undefined : { stageKey: first.value, touchCi: true };
}

/** One enabled escalation rule, as the vote count reads it. */
export interface VoteRuleCandidate {
  readonly when: EscalationWhen;
  readonly then: EscalationThen;
}

/**
 * How many enabled escalation rules add a review vote for this ticket?
 *
 * Evaluated with routing's own predicate (`routing/context.ts`), so *"this rule applies to this
 * work"* has one definition in the service. The context carries what the run's ticket is known
 * to be — its estimated effort and its labels; a `diff_kind` condition is never satisfied here,
 * because nothing classifies a change-set's diff kind yet, and an unclassified diff is not a
 * docs-only one.
 *
 * @param rules - The workspace's enabled rules.
 * @param context - The ticket's effort and labels.
 * @returns The number of `add_vote` rules whose predicate matches.
 */
export function countVoteRules(
  rules: readonly VoteRuleCandidate[],
  context: ResolutionContext,
): number {
  return rules.filter((rule) => "add_vote" in rule.then && matchesPredicate(rule.when, context))
    .length;
}

/**
 * Compose the review policy.
 *
 * @param policy - The pinned policy, or `undefined` when it could not be read.
 * @param voteRules - How many vote rules apply.
 * @returns The review facts, or `undefined` when the pin could not be read — which
 *   `review_required` answers with a conservative `fail`.
 */
export function reviewPolicy(
  policy: PinnedPolicy | undefined,
  voteRules: number,
): ReviewPolicy | undefined {
  return policy === undefined ? undefined : { autoMerges: policy.autoMerges, voteRules };
}

/**
 * Narrow an estimate's effort to routing's vocabulary.
 *
 * @param effort - `issue_estimates.effort`.
 * @returns The same five sizes, typed as routing reads them. The two scales are one vocabulary
 *   (V009's), which `constraints.sql` asserts across the tables that store them.
 */
export function asQueueEffort(effort: string | undefined): QueueEffort | undefined {
  return effort === "xs" || effort === "s" || effort === "m" || effort === "l" || effort === "xl"
    ? effort
    : undefined;
}
