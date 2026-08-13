/**
 * Membership: what a person holds in a workspace, and how a reference to one is resolved.
 *
 * A membership is flattened into one row of a workspace switcher — the workspace's id,
 * slug, display name and lifecycle, plus the role this person holds there — because that is
 * what every surface that shows one needs.
 *
 * **The type is written here rather than generated, since
 * [#711](https://github.com/NobuData/ouroboros/issues/711).** It used to be
 * `components["schemas"]["Membership"]`, from `GET /api/v1/auth/me`; that route was the
 * second answer to *who is signed in* and the issue deleted it, so the schema left the
 * contract with it. What `app/api/auth-server.ts` composes the rows from now is the auth family
 * — organizations and roles — which is **excluded from code generation** by the same rule,
 * so there is no generated type to point at and pretending otherwise would mean pointing at
 * an unrelated one.
 *
 * It is a stop, not a destination. [#714](https://github.com/NobuData/ouroboros/issues/714)
 * adds `GET /api/v1/orgs` — the Step 2 row model, in the generated family where a row model
 * belongs — and [#719](https://github.com/NobuData/ouroboros/issues/719) re-points this at
 * it, at which point this declaration goes back to being generated.
 *
 * `invitedAt` and `joinedAt` are gone with the old schema and are not reproduced. The
 * organization plugin keeps one timestamp where `tenant_members` kept two, nothing in this
 * module ever rendered either, and inventing a value for a field the service no longer
 * distinguishes would be worse than not carrying it.
 *
 * Everything here is **framework-free**, the same way `app/api/tenant.ts` is, and for the
 * same reason: these rules are read by a server-only data-access layer
 * (`app/api/access.ts`), by a pure view decision (`app/login/view.ts`) and by the tests,
 * and the three must not each keep their own copy of "which workspace did they mean" or
 * "who may change this". Nothing here reads a cookie, a header or the network.
 */

/** What a person may do in a workspace — `openapi.yaml` § `components.schemas.MemberRole`. */
export type Role = "owner" | "admin" | "member" | "viewer";

/**
 * The same four, as data — what `app/api/auth-client.ts`'s `asRole` checks a string against.
 *
 * The list has to exist somewhere the moment a role arrives as a string rather than as a
 * type, which it does at every boundary with the service. It is here rather than beside that
 * check so that the type above and the list below cannot come apart: `readonly Role[]` makes
 * a role added to one and forgotten in the other a compile error.
 */
export const ROLES: readonly Role[] = ["owner", "admin", "member", "viewer"];

/**
 * A workspace's lifecycle.
 *
 * Only `active` is reachable today: the organization plugin has no lifecycle column, so
 * `app/api/auth-server.ts` reports every workspace as one you can work in. The other two are
 * kept because the rule that reads them — {@link selectableMemberships} — is the rule, and a
 * screen that stopped checking is a screen that has to learn to again when #714 restores the
 * field.
 */
export type TenantStatus = "active" | "suspended" | "deleted";

/** One workspace the signed-in person belongs to, and the role they hold there. */
export interface Membership {
  /** The workspace's id. Named for the tenant it is: a membership is the `(tenant, person)` pair. */
  tenantId: string;
  slug: string;
  displayName: string;
  status: TenantStatus;
  role: Role;
}

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
