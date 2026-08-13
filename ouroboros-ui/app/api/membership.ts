/**
 * Membership: what a person holds in a workspace, and how a reference to one is resolved.
 *
 * A membership is one row of mockup 01 Step 2 and of every workspace switcher after it —
 * the workspace's id, slug, display name and monogram, whether it is somebody's own, how
 * many repositories are enabled inside it, one of them to name, and the roles this person
 * holds there.
 *
 * **The type is generated again, since
 * [#719](https://github.com/NobuData/ouroboros/issues/719).** It was
 * `components["schemas"]["Membership"]` from `GET /api/v1/auth/me` until
 * [#711](https://github.com/NobuData/ouroboros/issues/711) deleted that route, and a
 * hand-written stand-in in between — composed from `organization/list` plus one
 * `get-active-member-role` per workspace, because the plugin's listing discards the role on
 * the way out of its adapter and no single call answered both. `GET /api/v1/orgs`
 * ([#714](https://github.com/NobuData/ouroboros/issues/714)) is that call, so the stand-in
 * is gone and this points at the contract's own `OrgRow` again. What a screen renders is
 * therefore what the service said, field for field, and a renamed field in
 * `ouroboros-rest/openapi.yaml` is a failed typecheck here after `yarn api:sync` rather than
 * a row that quietly draws nothing.
 *
 * Three fields the stand-in carried are gone with it, and none of them is a loss:
 *
 * | Gone | Why |
 * |---|---|
 * | `tenantId` | `id` — the `{orgId}` every operation in the contract takes |
 * | `displayName` | `name` — what the service calls it, and what the monogram is derived from |
 * | `status` | the organization plugin has no lifecycle column, and `OrgRow` publishes none |
 *
 * `status` is the one worth a sentence. `tenants.status` had three values, `V006` did not
 * carry it across, and the filter that read it (`selectableMemberships`) was kept against
 * #714 restoring the field. #714 has landed and the row model does not carry it: **every
 * workspace the listing returns is one you can work in**, so the filter is gone rather than
 * left checking a field that no longer exists.
 *
 * Everything here is **framework-free**, the same way `app/api/tenant.ts` is, and for the
 * same reason: these rules are read by a server-only data-access layer
 * (`app/api/access.ts`), by a pure view decision (`app/login/view.ts`) and by the tests,
 * and the three must not each keep their own copy of "which workspace did they mean" or
 * "who may change this". Nothing here reads a cookie, a header or the network — the import
 * below is a `.d.ts`, so it carries types and no code at all.
 */

import type { components } from "@/app/api/schema";

/** What a person may do in a workspace — `openapi.yaml` § `components.schemas.MemberRole`. */
export type Role = components["schemas"]["MemberRole"];

/**
 * The same four, as data — what `app/api/auth-client.ts`'s `asRole` checks a string against.
 *
 * The list has to exist somewhere the moment a role arrives as a string rather than as a
 * type, which it does at every boundary with the service. It is here rather than beside that
 * check so that the type above and the list below cannot come apart: `readonly Role[]` makes
 * a role added to the contract and forgotten here a compile error.
 *
 * **The order is the order of power**, most to least, which {@link primaryRole} reads.
 */
export const ROLES: readonly Role[] = ["owner", "admin", "member", "viewer"];

/**
 * One workspace the signed-in person belongs to — mockup 01 Step 2's row, field for field.
 *
 * Named `Membership` rather than `OrgRow` because that is what it is to this application: a
 * workspace *and* what this person holds in it, which is the pair every screen showing one
 * needs. The generated name says where it came from; this one says what it means.
 */
export type Membership = components["schemas"]["OrgRow"];

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
 * @param role One role from a {@link Membership}.
 * @returns `true` for `owner` and `admin`, `false` for `member` and `viewer`.
 */
export function isAdminRole(role: Role): boolean {
  return ADMIN_ROLES.includes(role);
}

/**
 * Whether a membership's roles include one that may change the workspace.
 *
 * **The contract carries a list rather than a word** — "possibly none, for a membership
 * carrying only roles this service does not recognise" — so the question is whether *any* of
 * them administers, and an empty list is `false` rather than an error. That is the same
 * direction `asRole` errs in: a screen that guessed high would render a control the service
 * then refuses.
 *
 * @param roles The roles from a {@link Membership}.
 * @returns `true` when at least one of them is `owner` or `admin`.
 */
export function mayAdminister(roles: readonly Role[]): boolean {
  return roles.some(isAdminRole);
}

/**
 * The one role to name, out of the list a membership carries.
 *
 * A screen with room for a word rather than a list — the dashboard's subline — needs one,
 * and the truthful one is the strongest: somebody who is an `owner` and a `member` may do
 * everything an owner may.
 *
 * @param roles The roles from a {@link Membership}.
 * @returns The most powerful role held, or **`viewer`** when the list is empty or holds
 *   nothing this installation recognises — the least this API grants.
 */
export function primaryRole(roles: readonly Role[]): Role {
  return ROLES.find((role) => roles.includes(role)) ?? "viewer";
}

/**
 * Resolve a workspace reference against what the service says this person belongs to.
 *
 * The reference may be either form the contract accepts — a slug or an id — because it
 * arrives from a session pointer or from a form, and neither is a fact until it is checked.
 * Matching it against the memberships the *service* reported in this same request is the
 * whole point: it is one comparison, and it is what makes a hand-made POST naming somebody
 * else's workspace inert instead of a way to act in one.
 *
 * @param memberships The session's memberships.
 * @param reference A slug or id, or `undefined` when there is no choice to resolve.
 * @returns The membership it names, or `undefined` — which covers no reference and one
 *   naming a workspace this person does not belong to.
 */
export function activeMembership(
  memberships: readonly Membership[],
  reference: string | undefined,
): Membership | undefined {
  if (reference === undefined) return undefined;

  return memberships.find(
    (membership) => membership.slug === reference || membership.id === reference,
  );
}
