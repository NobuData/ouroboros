/**
 * What the merge routes answer — mockup 12's Merge plan card, and what a merge did.
 *
 * AX.4 ([#360](https://github.com/NobuData/ouroboros/issues/360)). Camel-cased over V058's
 * `pr_merge_plans`; instants as ISO 8601 strings. `disarmReason` is read apart into its designed
 * code and its sentence, so the card branches on the code and shows the sentence.
 *
 * `armedByPerson` (AY.7, [#369](https://github.com/NobuData/ouroboros/issues/369)) names who armed
 * the plan, for the card's footer. `armedBy` stays the id it always was.
 */

import type { PrMergeAction, PrMergeStrategy } from "../../db/schema";
import type { TicketClosure } from "./merge.actions";
import { parseDisarmReason, type MergeRefusalCode } from "./merge.recheck";
import type { MergePerson, StoredMergePlan } from "./merge.repository";

/** Why a re-check disarmed the plan. */
export interface DisarmReasonResource {
  /** The designed code — `gate_red`, `head_moved`, `host_conflict`, … */
  readonly code: MergeRefusalCode;
  /** The card's sentence. */
  readonly message: string;
}

/** A person — who armed the plan. */
export interface MergePersonResource {
  /** `user.id`. */
  readonly id: string;
  /** Their display name. */
  readonly name: string;
}

/** What a merge did. */
export interface MergedResultResource {
  /** The merge commit. */
  readonly sha: string;
  /** Who the host recorded — never a `[bot]` identity while merges are token-based. */
  readonly identityUsed: string;
  /** The configured actions that actually ran. */
  readonly actionsExecuted: readonly PrMergeAction[];
  /** When it merged. */
  readonly mergedAt: string;
}

/** One PR's merge plan. */
export interface MergePlanResource {
  readonly prId: string;
  readonly strategy: PrMergeStrategy;
  readonly deleteBranch: boolean;
  readonly commitMessage: string;
  readonly closeTicket: boolean;
  readonly commentEvidence: boolean;
  readonly backAnnotateEpic: boolean;
  readonly epicId: string | null;
  /** The "merge when all gates green" intent. */
  readonly armed: boolean;
  /** Who armed it, while armed — their id. */
  readonly armedBy: string | null;
  /** Who armed it, by name — null when disarmed, or when the person has since gone. */
  readonly armedByPerson: MergePersonResource | null;
  /** When, while armed. */
  readonly armedAt: string | null;
  /** The revision it was armed against, while armed. */
  readonly armedAgainstRevisionId: string | null;
  /** Why a re-check disarmed it — only on a disarmed plan, cleared by arming again. */
  readonly disarmReason: DisarmReasonResource | null;
  /** What the merge did, once it has. */
  readonly mergedResult: MergedResultResource | null;
  readonly updatedAt: string;
}

/** An action that was switched on and did not happen, and why. */
export interface FailedActionResource {
  readonly action: PrMergeAction;
  readonly detail: string;
}

/** What `POST …/merge` answers when the merge landed. */
export interface MergeOutcomeResource {
  /** The plan, final. */
  readonly plan: MergePlanResource;
  /** The canonical ticket's closure as the host reports it, or null for a PR without a ticket. */
  readonly ticket: TicketClosure | null;
  /** The switched-on actions that did not run — a ticket the host left open among them. */
  readonly failedActions: readonly FailedActionResource[];
}

/**
 * A stored plan as the routes answer it.
 *
 * @param plan - The plan.
 * @param armedBy - Who armed it, as read for `plan.armedBy` — null when nobody did, or when the
 *   person is gone. A person who is not the plan's `armedBy` is never named.
 * @returns The resource.
 */
export function mergePlanResource(
  plan: StoredMergePlan,
  armedBy: MergePerson | null,
): MergePlanResource {
  return {
    prId: plan.prId,
    strategy: plan.strategy,
    deleteBranch: plan.deleteBranch,
    commitMessage: plan.commitMessage,
    closeTicket: plan.closeTicket,
    commentEvidence: plan.commentEvidence,
    backAnnotateEpic: plan.backAnnotateEpic,
    epicId: plan.epicId,
    armed: plan.armed,
    armedBy: plan.armedBy,
    armedByPerson:
      armedBy === null || armedBy.id !== plan.armedBy
        ? null
        : { id: armedBy.id, name: armedBy.name },
    armedAt: plan.armedAt?.toISOString() ?? null,
    armedAgainstRevisionId: plan.armedAgainstRevisionId,
    disarmReason: parseDisarmReason(plan.disarmReason),
    mergedResult:
      plan.mergedResult === null
        ? null
        : {
            sha: plan.mergedResult.sha,
            identityUsed: plan.mergedResult.identity_used,
            actionsExecuted: plan.mergedResult.actions_executed,
            mergedAt: plan.mergedResult.merged_at,
          },
    updatedAt: plan.updatedAt.toISOString(),
  };
}
