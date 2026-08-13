/**
 * The session resource — who is signed in, and where sign-in begins.
 *
 * **It is composed from three calls now, and not from one.**
 * [#711](https://github.com/NobuData/ouroboros/issues/711) deleted `GET /api/v1/auth/me`,
 * which had been answering *who is signed in* beside BetterAuth's own session route: two
 * answers that could disagree, and the one built over `tenant_members` and `tenants` was
 * already answering nothing at all, because `V006__tenancy_extensions.sql` had dropped both
 * tables ([#708](https://github.com/NobuData/ouroboros/issues/708)). What replaces it is the
 * three routes that contract now publishes, and they divide the question the way BetterAuth
 * models it:
 *
 * | Call | Answers |
 * |---|---|
 * | `GET /api/auth/get-session` | the person, and which organization the session is acting in |
 * | `GET /api/auth/organization/list` | the workspaces they belong to |
 * | `GET /api/auth/organization/get-active-member-role` | what they hold in one of them |
 *
 * The third is a call *per workspace*, and that is a cost worth naming: the plugin's listing
 * discards the role on the way out of the adapter, so there is no one request that answers
 * both. It is a handful of small reads on a login screen rather than a fan-out on a hot
 * path, and [#714](https://github.com/NobuData/ouroboros/issues/714)'s
 * `GET /api/v1/orgs` — the Step 2 row model, with counts and roles together — is the single
 * call that replaces them. [#719](https://github.com/NobuData/ouroboros/issues/719) is what
 * re-points this module at it.
 *
 * They are called through `app/api/auth-client.ts` rather than through the generated client,
 * because that is the rule the contract states: **auth routes via the auth client,
 * everything else via the generated one**, and the auth family is excluded from codegen. See
 * that file for the base URL and the cookies, and for the note that
 * [#716](https://github.com/NobuData/ouroboros/issues/716) replaces it with BetterAuth's own
 * `createAuthClient`.
 *
 * `app/api/access.ts` is what reads this on behalf of a screen; this file is only the
 * vocabulary. What a membership *means* — which one a reference resolves to, and who may
 * change a workspace — is `app/api/membership.ts`, which is framework-free so that both this
 * and the screens can read the same rules.
 *
 * **Sign-in itself is not here at all**, and used to be: `githubSignInUrl()` composed the
 * address of BetterAuth's sign-in route on `ouroboros-rest` for the login screen to link to.
 * Beginning a sign-in is a `POST` whose answer the browser navigates to
 * ([#702](https://github.com/NobuData/ouroboros/issues/702)), so it is a request rather than
 * an address, it is made from the browser rather than from here, and it lives in
 * `app/login/sign-in.ts`. This module reads sessions; it no longer says how one starts.
 *
 * Server-side only, by way of `app/api/auth-client.ts` — see that file for why.
 */

import { authRead } from "@/app/api/auth-client";
import type { Membership } from "@/app/api/membership";

/** The signed-in person, in this application's vocabulary rather than the library's. */
export interface SessionUser {
  id: string;
  email: string;
  /** BetterAuth calls this `name`. */
  displayName: string;
  /** BetterAuth calls this `image`. `null` is what makes the UI draw a monogram. */
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A workspace whose registered email domain matches the person's address. Not membership.
 *
 * **Always `null` today, and the field is kept rather than removed.** It was the third part
 * of `GET /api/v1/auth/me`'s answer — *your organisation is already on Ouroboros, ask an
 * owner to add you* — and BetterAuth has no equivalent, because the question is about this
 * installation's tenant domains rather than about a session.
 * [#712](https://github.com/NobuData/ouroboros/issues/712)'s
 * `POST /api/v1/auth/discover` is where it moves, and
 * [#718](https://github.com/NobuData/ouroboros/issues/718) is what wires the screen to it.
 * Keeping the field means the one card that renders the state
 * (`app/login/workspace-card.tsx`) stays whole in the meantime, rendering nothing rather
 * than being deleted and rebuilt.
 */
export interface TenantSuggestion {
  tenantId: string;
  slug: string;
  displayName: string;
}

/** Who is signed in, the workspaces they belong to, and a suggestion when they have none. */
export interface Session {
  user: SessionUser;
  memberships: Membership[];
  tenantSuggestion: TenantSuggestion | null;
}

/** `GET /api/auth/get-session`, as `openapi.yaml` § `AuthSessionOrNull` describes it. */
interface AuthSessionEnvelope {
  session: { activeOrganizationId?: string | null };
  user: {
    id: string;
    email: string;
    name: string;
    image?: string | null;
    createdAt: string;
    updatedAt: string;
  };
}

/** One entry of `GET /api/auth/organization/list` — § `Organization`. */
interface AuthOrganization {
  id: string;
  name: string;
  slug: string;
}

/** `GET /api/auth/organization/get-active-member-role` — § `MemberRoleResponse`. */
interface MemberRoleAnswer {
  role: Membership["role"];
}

/**
 * The current session.
 *
 * One method, because a screen has one question. That it is now three requests is this
 * module's business and nobody else's.
 */
export const session = {
  /**
   * Who is signed in, and what they belong to.
   *
   * @param fetchImpl The fetch to call through. Defaults to the runtime's; the parameter is
   *   what lets a suite answer without a socket.
   * @returns The session, or **`null` when nobody is signed in**. `null` rather than a
   *   throw, because that is what `get-session` itself answers: the absence of a session is
   *   the answer a login screen is asking for, not a failure. This changed with
   *   [#711](https://github.com/NobuData/ouroboros/issues/711) — the route it replaced
   *   answered `401`, which every caller then had to translate.
   * @throws {AuthError} Any other refusal. A service that is failing is not a signed-out
   *   visitor, and rendering a sign-in screen for one would hide an outage behind a login
   *   form.
   */
  async read(fetchImpl: typeof fetch = fetch): Promise<Session | null> {
    const current = await authRead<AuthSessionEnvelope>("/get-session", fetchImpl);
    if (current === null) return null;

    const organizations = (await authRead<AuthOrganization[]>("/organization/list", fetchImpl)) ?? [];

    return {
      user: {
        id: current.user.id,
        email: current.user.email,
        displayName: current.user.name,
        avatarUrl: current.user.image ?? null,
        createdAt: current.user.createdAt,
        updatedAt: current.user.updatedAt,
      },
      memberships: await Promise.all(
        organizations.map((organization) => membershipOf(organization, fetchImpl)),
      ),
      tenantSuggestion: null,
    };
  },
};

/**
 * One organization, as the workspace switcher needs it.
 *
 * `status` is `active` for every row, and that is the plugin's model rather than a
 * placeholder: an organization has no lifecycle column. `tenants.status` did — `active`,
 * `suspended`, `deleted` — and `V006__tenancy_extensions.sql` did not carry it across,
 * because BetterAuth has nowhere to put it. So *every workspace the list returns is one you
 * can work in*, which is what `selectableMemberships` was filtering for; the filter stays,
 * because the field is still in the contract that
 * [#714](https://github.com/NobuData/ouroboros/issues/714) will re-introduce it from, and a
 * screen that stopped checking would be one that has to learn to again.
 *
 * @param organization One entry of the organization listing.
 * @param fetchImpl The fetch to call through.
 * @returns The membership, with the role read for this workspace specifically.
 */
async function membershipOf(
  organization: AuthOrganization,
  fetchImpl: typeof fetch,
): Promise<Membership> {
  const held = await authRead<MemberRoleAnswer>(
    `/organization/get-active-member-role?organizationId=${encodeURIComponent(organization.id)}`,
    fetchImpl,
  );

  return {
    tenantId: organization.id,
    slug: organization.slug,
    displayName: organization.name,
    status: "active",
    // `viewer` is the least this API grants, so it is what an unreadable role degrades to:
    // a screen that guessed high would render a control the service then refuses.
    role: held?.role ?? "viewer",
  };
}
