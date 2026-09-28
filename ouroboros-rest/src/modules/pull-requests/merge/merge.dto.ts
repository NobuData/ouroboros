/**
 * The merge routes' request shapes (AX.4, [#360](https://github.com/NobuData/ouroboros/issues/360)).
 *
 * The path is the criteria routes' {@link PullRequestParams} — one `:id`, a uuid.
 */

import { IsUUID } from "class-validator";

export { PullRequestParams } from "../criteria/criteria.dto";

/** `POST /api/v1/pull-requests/{id}/merge-plan/arm`. */
export class ArmMergePlanDto {
  /**
   * The revision whose gates the person looked at — `pr_revisions.id`. Arming is refused with
   * `409 merge_revision_stale` when it is no longer the PR's latest, so an arm is never a promise
   * about code nobody reviewed (decision V3).
   */
  @IsUUID()
  revisionId!: string;
}
