"use server";

/**
 * The Members & Roles card's writes, as Server Actions
 * (BS.3, [#493](https://github.com/NobuData/ouroboros/issues/493)).
 *
 * Each turns the service's refusal into a value the card can render — `{ok: false, reason}` with
 * the service's own sentence — so a refused capability change rolls back with a toast instead of
 * an error page. Anything that is not the service refusing (a redirect to sign in, a dropped
 * connection) keeps travelling, as `app/api/reading.ts` explains.
 *
 * **The role gate is the service's.** A Server Action is a POST anybody can reach; every route
 * behind these is `@Roles(...ADMINISTRATORS)`.
 *
 * **A token appears in exactly two answers** — {@link createServiceAccount} and
 * {@link rotateServiceAccount} — and goes nowhere else from here.
 */

import { isApiError } from "@/app/api/errors";
import {
  type MemberChange,
  type MemberInvitation,
  type OrganizationRole,
  type ServiceAccount,
  type ServiceAccountSecret,
  type ServiceScopeName,
  type WorkspaceMember,
  settingsMembers,
} from "@/app/api/settings-members";

import { type MembersWrite, refusalSentence } from "./view";

/**
 * Run one write, keeping a refusal as a value.
 *
 * @param write The call.
 * @returns Its outcome.
 * @throws Anything that is not the service refusing.
 */
async function written<T>(write: () => Promise<T>): Promise<MembersWrite<T>> {
  try {
    return { ok: true, value: await write() };
  } catch (error) {
    if (!isApiError(error)) throw error;
    return { ok: false, reason: refusalSentence(error.message), code: error.code };
  }
}

/**
 * Invite a person.
 *
 * @param email The address.
 * @param role The role they will join with.
 * @returns The pending invitation, or why not.
 */
export async function inviteMember(
  email: string,
  role: OrganizationRole,
): Promise<MembersWrite<MemberInvitation>> {
  return written(() => settingsMembers.invite(email, role));
}

/**
 * Refresh a pending invitation.
 *
 * @param id The invitation.
 * @returns The invitation as it now stands, or why not.
 */
export async function resendInvitation(id: string): Promise<MembersWrite<MemberInvitation>> {
  return written(() => settingsMembers.resend(id));
}

/**
 * Withdraw a pending invitation.
 *
 * @param id The invitation.
 * @returns Nothing, or why not.
 */
export async function revokeInvitation(id: string): Promise<MembersWrite<null>> {
  return written(async () => {
    await settingsMembers.revoke(id);
    return null;
  });
}

/**
 * Change a member's role or capability.
 *
 * @param memberId The membership.
 * @param change What to change.
 * @returns The member as they now stand, or why not.
 */
export async function updateMember(
  memberId: string,
  change: MemberChange,
): Promise<MembersWrite<WorkspaceMember>> {
  return written(() => settingsMembers.update(memberId, change));
}

/**
 * Remove a member.
 *
 * @param memberId The membership.
 * @returns Nothing, or why not.
 */
export async function removeMember(memberId: string): Promise<MembersWrite<null>> {
  return written(async () => {
    await settingsMembers.remove(memberId);
    return null;
  });
}

/**
 * Create a service account — the answer carries its token, once.
 *
 * @param name The name.
 * @param scopes The scopes.
 * @returns The account and its token, or why not.
 */
export async function createServiceAccount(
  name: string,
  scopes: readonly ServiceScopeName[],
): Promise<MembersWrite<ServiceAccountSecret>> {
  return written(() => settingsMembers.createServiceAccount(name, scopes));
}

/**
 * Rotate a service account's token — the answer carries the new one, once.
 *
 * @param id The account.
 * @returns The account and its new token, or why not.
 */
export async function rotateServiceAccount(
  id: string,
): Promise<MembersWrite<ServiceAccountSecret>> {
  return written(() => settingsMembers.rotateServiceAccount(id));
}

/**
 * Revoke a service account.
 *
 * @param id The account.
 * @returns The account, disabled, or why not.
 */
export async function revokeServiceAccount(id: string): Promise<MembersWrite<ServiceAccount>> {
  return written(() => settingsMembers.revokeServiceAccount(id));
}
