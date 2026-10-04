/**
 * The organization plugin's member and invitation API, as this module's port
 * ([#485](https://github.com/NobuData/ouroboros/issues/485)).
 *
 * **Enforcement stays the plugin's.** Every write is a call to `auth.api.*` *with the caller's own
 * cookies*, so the plugin runs its own permission checks for the caller — who may invite, who may
 * change whose role — exactly as it does for `/api/auth/organization/*`. This service adds the
 * rules the plugin does not have (the last-owner refusal with a clear reason, the audit trail) in
 * front of it, and never a second permission system beside it.
 *
 * Behind a Symbol token and an interface, like `settings/workspace.auth.ts`, so the service's
 * suite runs on a fake.
 */

import { Injectable } from "@nestjs/common";
import { AuthService as BetterAuth } from "@thallesp/nestjs-better-auth";

import type { Auth } from "../../auth/auth.factory";
import {
  ForbiddenError,
  InvalidRequestError,
  NotFoundError,
  UnauthenticatedError,
  type DomainError,
} from "../errors/error.envelope";
import type { OrganizationRole } from "../db/schema";

/** The injection token for {@link MemberDirectory}. */
export const MEMBER_DIRECTORY = Symbol("MEMBER_DIRECTORY");

/** The error code a plugin refusal is reported under, with the plugin's own reason. */
export const MEMBER_DIRECTORY_REFUSED = "member_directory_refused";

/** The plugin's member and invitation writes. */
export interface MemberDirectory {
  /**
   * Invite somebody, or refresh a pending invitation's expiry (`resend`).
   *
   * @param headers - The caller's cookies, so the plugin checks *their* permission.
   * @param input - The workspace, the address, the role, and whether this is a resend.
   */
  invite(
    headers: Headers,
    input: { organizationId: string; email: string; role: OrganizationRole; resend: boolean },
  ): Promise<void>;

  /**
   * Revoke a pending invitation.
   *
   * @param headers - The caller's cookies.
   * @param invitationId - The invitation.
   */
  cancelInvitation(headers: Headers, invitationId: string): Promise<void>;

  /**
   * Change a member's role.
   *
   * @param headers - The caller's cookies.
   * @param input - The workspace, the member and the new role.
   */
  updateRole(
    headers: Headers,
    input: { organizationId: string; memberId: string; role: OrganizationRole },
  ): Promise<void>;

  /**
   * Remove a member.
   *
   * @param headers - The caller's cookies.
   * @param input - The workspace and the member.
   */
  remove(headers: Headers, input: { organizationId: string; memberId: string }): Promise<void>;
}

/** The shape the library's `APIError` carries — read structurally rather than imported. */
interface PluginError {
  statusCode?: number;
  body?: { code?: string; message?: string };
  message?: string;
}

/**
 * Translate a plugin refusal into this API's envelope.
 *
 * @param error - Whatever the plugin threw.
 * @returns A `DomainError` carrying the plugin's reason, or the error unchanged when it is not a
 *   refusal (a crash stays a crash).
 */
export function pluginRefusal(error: unknown): unknown {
  const refusal = error as PluginError;
  const status = refusal?.statusCode;

  if (typeof status !== "number") return error;

  const message = refusal.body?.message ?? refusal.message ?? "The organization plugin refused.";
  const details = { reason: refusal.body?.code ?? null };
  const known: Record<number, () => DomainError> = {
    400: () => new InvalidRequestError(MEMBER_DIRECTORY_REFUSED, message, details),
    401: () => new UnauthenticatedError(MEMBER_DIRECTORY_REFUSED, message, details),
    403: () => new ForbiddenError(MEMBER_DIRECTORY_REFUSED, message, details),
    404: () => new NotFoundError(MEMBER_DIRECTORY_REFUSED, message, details),
  };

  return known[status]?.() ?? error;
}

@Injectable()
export class BetterAuthMemberDirectory implements MemberDirectory {
  /**
   * @param betterAuth - The library's service, whose `api` is the plugin's endpoints.
   */
  constructor(private readonly betterAuth: BetterAuth<Auth>) {}

  async invite(
    headers: Headers,
    input: { organizationId: string; email: string; role: OrganizationRole; resend: boolean },
  ): Promise<void> {
    await this.call(() =>
      this.betterAuth.api.createInvitation({
        headers,
        body: {
          organizationId: input.organizationId,
          email: input.email,
          role: input.role as "member",
          resend: input.resend,
        },
      }),
    );
  }

  async cancelInvitation(headers: Headers, invitationId: string): Promise<void> {
    await this.call(() =>
      this.betterAuth.api.cancelInvitation({ headers, body: { invitationId } }),
    );
  }

  async updateRole(
    headers: Headers,
    input: { organizationId: string; memberId: string; role: OrganizationRole },
  ): Promise<void> {
    await this.call(() =>
      this.betterAuth.api.updateMemberRole({
        headers,
        body: {
          organizationId: input.organizationId,
          memberId: input.memberId,
          role: input.role,
        },
      }),
    );
  }

  async remove(
    headers: Headers,
    input: { organizationId: string; memberId: string },
  ): Promise<void> {
    await this.call(() =>
      this.betterAuth.api.removeMember({
        headers,
        body: { organizationId: input.organizationId, memberIdOrEmail: input.memberId },
      }),
    );
  }

  /**
   * Run a plugin call, translating its refusals.
   *
   * @param work - The call.
   */
  private async call(work: () => Promise<unknown>): Promise<void> {
    try {
      await work();
    } catch (error) {
      throw pluginRefusal(error);
    }
  }
}
