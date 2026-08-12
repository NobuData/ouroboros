/**
 * Membership: what a person holds in a workspace, and how a reference to one is resolved.
 *
 * The contract flattens a membership into one row of a workspace switcher — the workspace's
 * id, slug, display name and lifecycle, plus the role this person holds there — because
 * that is what every surface that shows one needs (`openapi.yaml` §
 * `components.schemas.Membership`).
 *
 * Everything here is **framework-free**, the same way `app/api/tenant.ts` is, and for the
 * same reason: these rules are read by a server-only data-access layer
 * (`app/api/access.ts`), by a pure view decision (`app/login/view.ts`) and by the tests,
 * and the three must not each keep their own copy of "which workspace did they mean" or
 * "who may change this". Nothing here reads a cookie, a header or the network.
 */

import type { components } from "@/app/api/schema";

/** One workspace the signed-in person belongs to, and the role they hold there. */
export type Membership = components["schemas"]["Membership"];

/** What a person may do in a workspace, as the contract enumerates it. */
export type Role = Membership["role"];

/** A workspace's lifecycle, as the contract enumerates it. */
export type TenantStatus = Membership["status"];

/**
 * The roles that may change a workspace — `owner` and `admin`.
 *
 * The contract states the rule once, for every mutation it describes: "Administering a
 * workspace is `owner` or `admin`; `member` and `viewer` may read it." This is that
 * sentence as data, so the screen that renders a read-only switch and the service that
 * would refuse the write agree about who may act.
 */
export const ADMIN_ROLES: readonly Role[] = ["owner", "admin"];

/**
 * Whether a role may change the workspace it is held in.
 *
 * @param role The role from a {@link Membership}.
 * @returns `true` for `owner` and `admin`, `false` for `member` and `viewer`.
 */
export function isAdminRole(role: Role): boolean {
  return ADMIN_ROLES.includes(role);
}

/**
 * The memberships a person may actually choose to work in.
 *
 * A suspended or deleted workspace stays in the list the service returns — the contract
 * carries `status` precisely so a switcher can render one as such — but it is not somewhere
 * to operate, so it is not somewhere to select. The login screen shows such a row and says
 * why; nothing else offers it.
 *
 * @param memberships The session's memberships.
 * @returns Those whose workspace is `active`, in the order the service returned them.
 */
export function selectableMemberships(
  memberships: readonly Membership[],
): readonly Membership[] {
  return memberships.filter((membership) => membership.status === "active");
}

/**
 * Resolve a workspace reference against what the service says this person belongs to.
 *
 * The reference may be either form the contract accepts — a slug or a uuid — because it
 * arrives from a cookie or a URL, and both are things a person can type or edit. Matching
 * it against the session's *own* memberships rather than trusting it is the whole point:
 * it is one comparison, and it is what makes an edited `ouro_tenant` cookie inert instead
 * of a way to name somebody else's workspace.
 *
 * @param memberships The session's memberships.
 * @param reference A slug or uuid, or `undefined` when there is no choice to resolve.
 * @returns The selectable membership it names, or `undefined` — which covers no reference,
 *   a reference naming a workspace this person has left, and one naming a suspended
 *   workspace.
 */
export function activeMembership(
  memberships: readonly Membership[],
  reference: string | undefined,
): Membership | undefined {
  if (reference === undefined) return undefined;

  return selectableMemberships(memberships).find(
    (membership) => membership.slug === reference || membership.tenantId === reference,
  );
}
