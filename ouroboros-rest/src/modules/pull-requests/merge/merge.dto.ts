/**
 * The merge routes' request shapes (AX.4, [#360](https://github.com/NobuData/ouroboros/issues/360);
 * the edit is AY.7's, [#369](https://github.com/NobuData/ouroboros/issues/369)).
 *
 * The path is the criteria routes' {@link PullRequestParams} — one `:id`, a uuid.
 */

import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
} from "class-validator";

export { PullRequestParams } from "../criteria/criteria.dto";

/** V058's `pr_merge_plans_commit_message_present` — at most 16384 characters. */
export const MAX_COMMIT_MESSAGE_LENGTH = 16_384;

/**
 * Not blank and not padded — V058's `length(btrim(commit_message)) > 0`, held to the rule every
 * other text of the PR plane keeps (`criteria.dto.ts`), so what is stored is what was meant.
 */
const TRIMMED = /^\S(.*\S)?$/s;

/**
 * Whether a field was sent at all. `@IsOptional` would also wave `null` through, and only the epic
 * can be cleared — so every other field is validated whenever the request named it.
 *
 * @param _body - The request.
 * @param value - The field.
 * @returns `true` when the request named the field, with `null` or anything else.
 */
function sent(_body: object, value: unknown): boolean {
  return value !== undefined;
}

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

/**
 * `PATCH /api/v1/pull-requests/{id}/merge-plan` — only what is sent changes.
 *
 * The strategy and delete-branch are the pinned policy's and are not fields here: the validation
 * pipe refuses them as unknown, with every other field this class does not declare.
 */
export class UpdateMergePlanDto {
  /** The merge commit's message — neither blank nor padded, and bounded as V058 bounds it. */
  @ValidateIf(sent)
  @Matches(TRIMMED, { message: "commitMessage must not be empty or padded with whitespace" })
  @MaxLength(MAX_COMMIT_MESSAGE_LENGTH)
  @IsString()
  commitMessage?: string;

  /** Close the canonical ticket on merge. */
  @ValidateIf(sent)
  @IsBoolean()
  closeTicket?: boolean;

  /** Comment the evidence summary on the host PR. */
  @ValidateIf(sent)
  @IsBoolean()
  commentEvidence?: boolean;

  /** Back-annotate the roadmap epic — refused while the plan names none. */
  @ValidateIf(sent)
  @IsBoolean()
  backAnnotateEpic?: boolean;

  /** The planning epic to back-annotate, of this workspace — or `null` to clear it. */
  @IsOptional()
  @IsUUID()
  epicId?: string | null;
}
