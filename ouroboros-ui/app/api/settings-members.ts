/**
 * The Members & Roles card's operations
 * ([#485](https://github.com/NobuData/ouroboros/issues/485) built them, BS.3
 * [#493](https://github.com/NobuData/ouroboros/issues/493) draws them).
 *
 * `GET /api/v1/settings/members` answers mockup 17's whole table in one read — people, pending
 * invitations, service accounts, whether the caller may manage, and the footer — and every write
 * the card makes goes through `/api/v1/settings/members/…` or
 * `/api/v1/settings/service-accounts/…`, never `/api/auth/organization/*`. The service wraps the
 * organization plugin itself, so the last-owner rule and the audit trail are enforced in one
 * place (`app/api/members.ts` still reads the plugin, for the dashboard's count).
 *
 * **Tokens.** Only `createServiceAccount` and `rotateServiceAccount` answer with a token, and
 * they answer with it once; the list carries a masked hint at most. Nothing here keeps, logs or
 * returns a token anywhere else.
 *
 * Server-side only, by way of `app/api/server.ts`.
 */

import { type ApiClient, unwrap } from "@/app/api/client";
import type { components } from "@/app/api/schema";
import { api } from "@/app/api/server";

/** The card's whole read. */
export type MembersPage = components["schemas"]["MembersPage"];
/** One person in the workspace. */
export type WorkspaceMember = components["schemas"]["Member"];
/** A pending invitation — the dimmed row. */
export type MemberInvitation = components["schemas"]["MemberInvitation"];
/** A service account, as a `Service` row. Never a token. */
export type ServiceMember = components["schemas"]["ServiceMember"];
/** A plugin role — what the service enforces. */
export type OrganizationRole = components["schemas"]["OrganizationRole"];
/** Decision S3's display label. */
export type MemberDisplayRole = components["schemas"]["MemberDisplayRole"];
/** A registered service scope. */
export type ServiceScopeName = components["schemas"]["ServiceScopeName"];
/** A scope and the sentence that says what it allows. */
export type ServiceScope = components["schemas"]["ServiceScope"];
/** A service account with its live token's masked hint. */
export type ServiceAccount = components["schemas"]["ServiceAccount"];
/** The service-account list: the accounts, and the registered scopes. */
export type ServiceAccountList = components["schemas"]["ServiceAccountList"];
/** The create and rotate answer — the one time a token is returned. */
export type ServiceAccountSecret = components["schemas"]["ServiceAccountSecret"];

/** A role change, a capability setting, or both. */
export interface MemberChange {
  readonly role?: OrganizationRole;
  readonly canApproveLoops?: boolean;
}

/** The card's reads and writes. */
export const settingsMembers = {
  /**
   * The Members & Roles card, as the service draws it.
   *
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The page. Any member may read it.
   * @throws {ApiError} What the service answered.
   */
  async read(client: ApiClient = api()): Promise<MembersPage> {
    return unwrap(await client.GET("/api/v1/settings/members", {}));
  },

  /**
   * Invite a person by address. The pending row it answers with is the card's new dimmed row.
   *
   * @param email The address.
   * @param role The plugin role they will join with.
   * @param client The client to call through.
   * @returns The invitation.
   * @throws {ApiError} `403 forbidden`, `422 validation_failed` or `member_directory_refused`.
   */
  async invite(
    email: string,
    role: OrganizationRole,
    client: ApiClient = api(),
  ): Promise<MemberInvitation> {
    return unwrap(
      await client.POST("/api/v1/settings/members/invitations", { body: { email, role } }),
    );
  },

  /**
   * Refresh a pending invitation's expiry. Its `invitedAt` does not move.
   *
   * @param id The invitation.
   * @param client The client to call through.
   * @returns The invitation as it now stands.
   * @throws {ApiError} `404 invitation_not_found`, `409 invitation_not_pending`.
   */
  async resend(id: string, client: ApiClient = api()): Promise<MemberInvitation> {
    return unwrap(
      await client.POST("/api/v1/settings/members/invitations/{id}/resend", {
        params: { path: { id } },
      }),
    );
  },

  /**
   * Withdraw a pending invitation.
   *
   * @param id The invitation.
   * @param client The client to call through.
   * @throws {ApiError} `404 invitation_not_found`, `409 invitation_not_pending`.
   */
  async revoke(id: string, client: ApiClient = api()): Promise<void> {
    await client.DELETE("/api/v1/settings/members/invitations/{id}", {
      params: { path: { id } },
    });
  },

  /**
   * Change a member's role, their `canApproveLoops`, or both.
   *
   * @param memberId The membership's id.
   * @param change What to change.
   * @param client The client to call through.
   * @returns The member as they now stand.
   * @throws {ApiError} `409 owner_protected` for the last owner, `422 member_directory_refused`.
   */
  async update(
    memberId: string,
    change: MemberChange,
    client: ApiClient = api(),
  ): Promise<WorkspaceMember> {
    return unwrap(
      await client.PATCH("/api/v1/settings/members/{memberId}", {
        params: { path: { memberId } },
        body: change,
      }),
    );
  },

  /**
   * Remove a member from the workspace.
   *
   * @param memberId The membership's id.
   * @param client The client to call through.
   * @throws {ApiError} `409 owner_protected` for the last owner.
   */
  async remove(memberId: string, client: ApiClient = api()): Promise<void> {
    await client.DELETE("/api/v1/settings/members/{memberId}", {
      params: { path: { memberId } },
    });
  },

  /**
   * Every service account, tokens masked, with the registered scopes — owners and admins only.
   *
   * @param client The client to call through.
   * @returns The list.
   * @throws {ApiError} `403 forbidden` for anybody else.
   */
  async serviceAccounts(client: ApiClient = api()): Promise<ServiceAccountList> {
    return unwrap(await client.GET("/api/v1/settings/service-accounts", {}));
  },

  /**
   * Create a service account. **The answer is the only time its token exists outside a hash.**
   *
   * @param name The account's name.
   * @param scopes What it may do.
   * @param client The client to call through.
   * @returns The account and its token.
   * @throws {ApiError} `409 service_account_name_taken`, `422 validation_failed`.
   */
  async createServiceAccount(
    name: string,
    scopes: readonly ServiceScopeName[],
    client: ApiClient = api(),
  ): Promise<ServiceAccountSecret> {
    return unwrap(
      await client.POST("/api/v1/settings/service-accounts", {
        body: { name, scopes: [...scopes] },
      }),
    );
  },

  /**
   * Replace a service account's token. The old one stops working when this answers.
   *
   * @param id The account.
   * @param client The client to call through.
   * @returns The account and its new token, once.
   * @throws {ApiError} `404 service_account_not_found`, `409 service_account_disabled`.
   */
  async rotateServiceAccount(id: string, client: ApiClient = api()): Promise<ServiceAccountSecret> {
    return unwrap(
      await client.POST("/api/v1/settings/service-accounts/{id}/rotate", {
        params: { path: { id } },
      }),
    );
  },

  /**
   * Revoke a service account: its token dies and the account is disabled.
   *
   * @param id The account.
   * @param client The client to call through.
   * @returns The account, disabled.
   * @throws {ApiError} `404 service_account_not_found`.
   */
  async revokeServiceAccount(id: string, client: ApiClient = api()): Promise<ServiceAccount> {
    return unwrap(
      await client.POST("/api/v1/settings/service-accounts/{id}/revoke", {
        params: { path: { id } },
      }),
    );
  },
};
