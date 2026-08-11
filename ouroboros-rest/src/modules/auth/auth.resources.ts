/**
 * What `GET /api/v1/auth/me` returns, and the one place a row becomes it.
 *
 * The same division `src/modules/tenancy/resources.ts` sets out and for the same reasons:
 * rows keep the database's names, resources keep the API's, and the translation happens in
 * one function per resource rather than wherever a service happens to build a response.
 *
 * `/auth/me` is the first thing `ouroboros-ui` asks after a page load, and what it answers
 * decides what the shell can render without a second round trip: who you are, which
 * workspaces you may switch between, and — when you belong to none — whether the
 * organisation behind your address is already here. That is why it is one object with
 * three parts rather than three endpoints.
 */

import type { Tenant, TenantRole, TenantStatus, User } from "../db/schema";

/** The signed-in person, as `/auth/me` answers. */
export interface UserResource {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * One workspace the signed-in person belongs to.
 *
 * Flattened rather than `{tenant: {…}, role}`: it is a row of a workspace switcher, and
 * every field here is something that switcher renders. The tenant's `id` is named
 * `tenantId` for the same reason `MemberResource` does — the membership is the
 * `(tenant, person)` pair, and this is the tenant half of one.
 */
export interface MembershipResource {
  tenantId: string;
  slug: string;
  displayName: string;
  status: TenantStatus;
  role: TenantRole;
  invitedAt: string;
  /** `null` while the invitation is outstanding. */
  joinedAt: string | null;
}

/**
 * The tenant this person's email domain points at, when they belong to none yet.
 *
 * Deliberately thin — an id, a handle and a name — because it is an *offer to ask*, not a
 * membership. Nothing about it grants access: the tenant is named so
 * [#44](https://github.com/NobuData/ouroboros/issues/44) can say "Acme is already on
 * Ouroboros" instead of dropping a new signee into an empty product with no idea their
 * colleagues are here.
 */
export interface TenantSuggestionResource {
  tenantId: string;
  slug: string;
  displayName: string;
}

/** The whole of `GET /api/v1/auth/me`. */
export interface SessionResource {
  user: UserResource;
  memberships: MembershipResource[];
  /**
   * A tenant worth asking to join, or `null`.
   *
   * Non-null only when the person belongs to no tenant *and* their address's domain is one
   * some tenant has registered. Somebody who is already a member is being shown their
   * memberships, and a suggestion beside them would be noise.
   */
  tenantSuggestion: TenantSuggestionResource | null;
}

/**
 * The columns a membership listing selects.
 *
 * A membership joined to its tenant, named as the join returns it. Declared here rather
 * than inferred from the query so {@link membershipResource} states what it needs and the
 * repository is checked against it.
 */
export interface MembershipRow {
  tenant_id: string;
  slug: string;
  display_name: string;
  status: TenantStatus;
  role: TenantRole;
  invited_at: Date;
  joined_at: Date | null;
}

/**
 * Render a timestamp for the wire.
 *
 * @param instant - The instant, as `pg` parsed it.
 * @returns ISO-8601 with a `Z` offset.
 */
function at(instant: Date): string {
  return instant.toISOString();
}

/**
 * @param row - A row of `ouroboros.users`.
 * @returns Its API representation.
 */
export function userResource(row: User): UserResource {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    createdAt: at(row.created_at),
    updatedAt: at(row.updated_at),
  };
}

/**
 * @param row - A membership joined to its tenant.
 * @returns Its API representation.
 */
export function membershipResource(row: MembershipRow): MembershipResource {
  return {
    tenantId: row.tenant_id,
    slug: row.slug,
    displayName: row.display_name,
    status: row.status,
    role: row.role,
    invitedAt: at(row.invited_at),
    joinedAt: row.joined_at === null ? null : at(row.joined_at),
  };
}

/**
 * @param row - A row of `ouroboros.tenants` an address's domain resolved to.
 * @returns The three fields a suggestion is allowed to carry. Not `tenantResource`: this
 *   is shown to somebody who is *not* a member, so its lifecycle and timestamps are none
 *   of their business.
 */
export function tenantSuggestionResource(row: Tenant): TenantSuggestionResource {
  return {
    tenantId: row.id,
    slug: row.slug,
    displayName: row.display_name,
  };
}
