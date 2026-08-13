import "server-only";

/**
 * What this request is allowed to see: the session it carries, and the workspace it is
 * operating in.
 *
 * This is the module every signed-in screen goes through, and it is deliberately the
 * *only* one — the framework's own guidance is that an authorization check belongs beside
 * the data rather than in a layout, because a layout does not re-render on a client-side
 * navigation and does not control whether the rest of the route renders anyway
 * (`node_modules/next/dist/docs/01-app/02-guides/authentication.md` § Layouts and auth
 * checks). So `app/(app)/layout.tsx` holds no check, and a page in that group calls
 * {@link requireWorkspace} to obtain the workspace it is about to render — which means
 * the page that forgot the check is also the page with no data to render.
 *
 * {@link currentAccess} is wrapped in React's `cache`, so the layout, the page and a
 * Server Action in the same request share one session read between them. That is what makes
 * calling it freely the right thing to do rather than a cost to budget — a read is two
 * requests, one to each family, and `app/api/auth-server.ts` is where they are named.
 *
 * Two rules the rest of the application inherits from here:
 *
 * 1. **A session alone is not access.** Every operation in the contract except the five
 *    public ones is scoped to a workspace, so "signed in" and "able to render the product"
 *    are different states, and the second one needs a workspace this person still belongs
 *    to. The login screen (#44) is where the choice is made.
 * 2. **The pointer is a reference, not a fact.** The active workspace is
 *    `session."activeOrganizationId"` since
 *    [#719](https://github.com/NobuData/ouroboros/issues/719) — server state, written only
 *    by `set-active` — and it is still resolved against the memberships the service reported
 *    in this same request rather than trusted. A session pointing at a workspace somebody has
 *    since been removed from resolves to no choice at all, and lands on the login screen
 *    rather than on a screen of somebody else's data.
 *
 *    That check used to be doing much more, because the reference came from the `ouro_tenant`
 *    cookie and a cookie is whatever the browser was last given. It is cheap and it stays:
 *    the cost of keeping it is one comparison, and the cost of dropping it is discovering
 *    that a stale pointer renders a workspace nobody is a member of.
 */

import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";

import { type Membership, activeMembership } from "@/app/api/membership";
import { LOGIN_PATH } from "@/app/api/server";
import { readSession } from "@/app/api/auth-server";
import type { Session } from "@/app/api/identity";

/** What a request carries: a session or nothing, and an active workspace or nothing. */
export interface Access {
  /** The signed-in person and their memberships, or `null` when nobody is signed in. */
  session: Session | null;
  /**
   * The workspace `session."activeOrganizationId"` names, if the session still reports a
   * membership of it. `undefined` covers every other case — a session acting nowhere, and
   * one pointing at a workspace this person has since left.
   */
  membership: Membership | undefined;
}

/** A request that has both: somebody signed in, and a workspace to operate in. */
export interface Workspace {
  /** The session, present by construction. */
  session: Session;
  /** The active workspace, present by construction. */
  membership: Membership;
}

/**
 * Who is signed in on this request, and which workspace they are operating in.
 *
 * Memoised for the length of one request by React's `cache`, so every caller in a render
 * pass — a layout, a page, a Server Action — shares one call to the service.
 *
 * **Nobody signed in is an answer here rather than a failure**, and since
 * [#711](https://github.com/NobuData/ouroboros/issues/711) it is the service's answer rather
 * than this layer's translation of one: `GET /api/auth/get-session` replies `null` for a
 * request carrying no session, so there is no `401` to read as *signed out* and no need for
 * the `anonymousApi()` this used to reach for — the client whose `401` handling would have
 * sent the login screen to itself. Every failure is now left to reject, which is the shape
 * that was always wanted: a `500` from the service is not a signed-out visitor, and
 * rendering a sign-in screen for one would hide an outage behind a login form.
 *
 * @returns The session and the active workspace, either of which may be absent.
 * @throws {AuthError} Any refusal at all. See above for why none of them means *signed out*.
 */
export const currentAccess = cache(async (): Promise<Access> => {
  // Prerendering stops here. Every screen that goes through this gate is per-request by
  // definition, and without this line `next build` would try to render one — reaching
  // `restUrl()` on a machine that has no reason to know the address of a service it is not
  // calling, and failing the build on a correctly configured checkout. The cookies below
  // would opt the route out too, but only after that throw: saying so first makes the
  // requirement the layer's own rather than an accident of statement order.
  await connection();

  const current = await readSession();
  if (current === null) return { session: null, membership: undefined };

  return {
    session: current,
    membership: activeMembership(
      current.memberships,
      current.activeOrganizationId ?? undefined,
    ),
  };
});

/**
 * The workspace this request may render, or a redirect to the login screen.
 *
 * The gate for every screen in `app/(app)`: it returns what such a screen needs — the
 * person and the workspace — and it never returns at all for a request that has no
 * business there. `redirect` signals by throwing, so nothing after a failed check runs.
 *
 * Both halves send a visitor to the same place, because the login screen is where both are
 * resolved: it signs somebody in, and then it asks which workspace the loop should run in.
 *
 * @returns The session and the active workspace, both present.
 * @throws Next.js's redirect signal, when there is no session or no chosen workspace.
 */
export async function requireWorkspace(): Promise<Workspace> {
  const { session, membership } = await currentAccess();

  if (session === null || membership === undefined) {
    redirect(LOGIN_PATH);
  }

  return { session, membership };
}
