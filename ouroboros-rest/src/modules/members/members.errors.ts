/**
 * The Members card's refusals ([#485](https://github.com/NobuData/ouroboros/issues/485)).
 *
 * Not `member_not_found` or `last_owner`: those are codes #714 retired with the old member CRUD
 * (`tenancy/tenancy.errors.ts`'s `RETIRED_ERRORS`), and a client switching on them must not find
 * them answering again. The plugin's own refusals arrive as `member_directory_refused`
 * (`members.auth.ts`).
 */

import { ConflictError, InvalidRequestError, NotFoundError } from "../errors/error.envelope";

/** Every code this module raises. */
export const MEMBERS_ERRORS = {
  memberNotFound: "workspace_member_not_found",
  invitationNotFound: "invitation_not_found",
  invitationNotPending: "invitation_not_pending",
  ownerProtected: "owner_protected",
  updateEmpty: "member_update_empty",
} as const;

/**
 * No such member in this workspace.
 *
 * @param memberId - The id asked for.
 * @returns A `404`.
 */
export function workspaceMemberNotFound(memberId: string): NotFoundError {
  return new NotFoundError(MEMBERS_ERRORS.memberNotFound, "No such member of this workspace.", {
    memberId,
  });
}

/**
 * No such invitation in this workspace.
 *
 * @param invitationId - The id asked for.
 * @returns A `404`.
 */
export function invitationNotFound(invitationId: string): NotFoundError {
  return new NotFoundError(MEMBERS_ERRORS.invitationNotFound, "No such invitation.", {
    invitationId,
  });
}

/**
 * The invitation was already accepted, rejected or revoked.
 *
 * @param invitationId - The invitation.
 * @param status - Where it stands.
 * @returns A `409`.
 */
export function invitationNotPending(invitationId: string, status: string): ConflictError {
  return new ConflictError(
    MEMBERS_ERRORS.invitationNotPending,
    `This invitation is ${status}, not pending.`,
    { invitationId, status },
  );
}

/**
 * The change would leave the workspace with no owner.
 *
 * @param memberId - The last owner.
 * @param attempt - `demote` or `remove`.
 * @returns A `409` naming the reason.
 */
export function ownerProtected(memberId: string, attempt: "demote" | "remove"): ConflictError {
  return new ConflictError(
    MEMBERS_ERRORS.ownerProtected,
    attempt === "demote"
      ? "This is the workspace's last owner. Make someone else an owner before changing this role."
      : "This is the workspace's last owner. Make someone else an owner before removing them.",
    { memberId, attempt },
  );
}

/**
 * A `PATCH` that names nothing to change.
 *
 * @returns A `422`.
 */
export function memberUpdateEmpty(): InvalidRequestError {
  return new InvalidRequestError(
    MEMBERS_ERRORS.updateEmpty,
    "Name a role or canApproveLoops to change.",
  );
}
