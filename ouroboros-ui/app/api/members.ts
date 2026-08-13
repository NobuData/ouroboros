/**
 * The members resource — who belongs to a workspace, and in what role.
 *
 * **It calls the auth family now, and that is a move rather than a rewrite.**
 * `GET /api/v1/tenants/{tenantId}/members` was this module's source until
 * [#714](https://github.com/NobuData/ouroboros/issues/714), which deleted every member
 * operation from `ouroboros-rest`'s tenancy module: the organization plugin serves them
 * natively since [#704](https://github.com/NobuData/ouroboros/issues/704), and two write
 * paths to one membership table is how two role checks drift apart. So this reads
 * `GET /api/auth/organization/get-full-organization` — mockup 17's members table in a single
 * answer — through `app/api/auth-client.ts`, which is the rule the contract states: **auth
 * routes via the auth client, everything else via the generated one.**
 *
 * Only the listing is wrapped. The dashboard ([#45](https://github.com/NobuData/ouroboros/issues/45))
 * needs a count and the roles behind it; inviting, removing and re-roling somebody are the
 * workspace-settings screen's ([#491](https://github.com/NobuData/ouroboros/issues/491))
 * mutations and are the plugin's `invite-member` / `update-member-role` / `remove-member` when
 * that screen is written.
 *
 * **The types are written here rather than generated**, the same way `app/api/membership.ts`
 * is and for the same reason: the auth family is excluded from code generation, so there is no
 * generated type to point at and pretending otherwise would mean pointing at an unrelated one.
 * What is declared is only what a screen reads.
 *
 * Server-side only, by way of `app/api/auth-client.ts` — see that file for why.
 */

import { authRead } from "@/app/api/auth-client";
import type { Role } from "@/app/api/membership";

/**
 * One member: the person, and what they may do in this workspace.
 *
 * `invitedAt` and `joinedAt` are gone with the old schema and are not reproduced. The
 * organization plugin keeps one timestamp where `tenant_members` kept two — an outstanding
 * invitation lives on an `invitation` row until it is accepted, and the member row is written
 * at acceptance — so `joinedAt` is the only one there is, and inventing the other would be a
 * field the service no longer distinguishes.
 */
export interface Member {
  /** The workspace's id. */
  orgId: string;
  /** The person's id. */
  userId: string;
  /** What they may do here. */
  role: Role;
  /** When the membership came into being. */
  joinedAt: string;
  /** Their address, when the listing joined the person in. */
  email: string | null;
  /** What a member table prints beside the avatar, when the person is joined in. */
  displayName: string | null;
  /** `null` is what makes the UI draw a monogram. */
  avatarUrl: string | null;
}

/** A page of members: `{items, total, limit, offset}`, the shape every listing here takes. */
export interface MemberPage {
  items: Member[];
  total: number;
  limit: number;
  offset: number;
}

/** The window a listing accepts. Applied here rather than by the service — see {@link members}. */
export interface MemberListQuery {
  limit?: number;
  offset?: number;
}

/** How many rows a caller that named no window gets, matching the contract's own default. */
const DEFAULT_LIMIT = 25;

/** `GET /api/auth/organization/get-full-organization` — § `FullOrganizationOrNull`. */
interface FullOrganization {
  id: string;
  members?: OrganizationMember[];
}

/** One entry of it — § `OrganizationMember`. */
interface OrganizationMember {
  organizationId: string;
  userId: string;
  role: Role;
  createdAt: string;
  user?: { email?: string | null; name?: string | null; image?: string | null } | null;
}

/**
 * A workspace's members.
 *
 * The method takes the fetch to call through as an optional last argument, defaulting to the
 * runtime's. Production never passes it; tests pass one that answers without a socket, which
 * is what lets this be covered without a request, an environment or a cookie.
 */
export const members = {
  /**
   * One page of the workspace's members.
   *
   * **The window is applied here, not by the service.** The plugin answers with the whole
   * membership and offers no pagination, so this slices what it returned — which keeps
   * `{items, total, limit, offset}` an honest description of what a caller got, and keeps
   * `total` the workspace's whole membership however small the window was. That is the field
   * a count should be read from, and it is what the dashboard's card renders.
   *
   * @param tenantId The workspace's id.
   * @param query `limit` (default 25) and `offset`.
   * @param fetchImpl The fetch to call through. Defaults to the runtime's.
   * @returns The page. A workspace the caller cannot see answers `null` or refuses, and an
   *   absent one comes back as an empty page rather than as a throw — "no members listed" is
   *   a card the dashboard can draw, and a missing organization is not this call's news.
   * @throws {AuthError} What the auth family answered — `403` for a caller who is not a
   *   member of it.
   */
  async list(
    tenantId: string,
    query: MemberListQuery = {},
    fetchImpl: typeof fetch = fetch,
  ): Promise<MemberPage> {
    const organization = await authRead<FullOrganization>(
      `/organization/get-full-organization?organizationId=${encodeURIComponent(tenantId)}`,
      fetchImpl,
    );

    const all = organization?.members ?? [];
    const limit = query.limit ?? DEFAULT_LIMIT;
    const offset = query.offset ?? 0;

    return {
      items: all.slice(offset, offset + limit).map(memberOf),
      total: all.length,
      limit,
      offset,
    };
  },
};

/**
 * One membership, in this application's vocabulary rather than the library's.
 *
 * @param member One entry of the plugin's listing.
 * @returns The member. The person's own fields are `null` when the listing did not join them
 *   in — preserved rather than defaulted, because "we did not ask for the person" and "the
 *   person has no name" are different facts and a member table renders them differently.
 */
function memberOf(member: OrganizationMember): Member {
  return {
    orgId: member.organizationId,
    userId: member.userId,
    role: member.role,
    joinedAt: member.createdAt,
    email: member.user?.email ?? null,
    displayName: member.user?.name ?? null,
    avatarUrl: member.user?.image ?? null,
  };
}
