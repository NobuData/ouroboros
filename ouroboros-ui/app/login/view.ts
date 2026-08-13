/**
 * What the login screen shows, decided from three values and nothing else.
 *
 * The screen has one route and five outcomes, and keeping the choice between them in a
 * pure function is what makes each one something a test can name: the page reads the
 * request, this decides, and the components render. Nothing here touches the framework,
 * the network or a cookie.
 *
 * The three inputs are the whole of the request's state:
 *
 * | | |
 * |---|---|
 * | `session` | what `GET /api/v1/auth/me` said, or `null` for nobody |
 * | `membership` | the workspace the `ouro_tenant` cookie names, already checked against that session (`app/api/access.ts`) |
 * | `workspace` | the `?workspace=` slug in the URL — the marker that says *I am mid-flow* |
 *
 * ### Why the URL carries a marker at all
 *
 * Two requirements of #44 pull in opposite directions: an authenticated visitor "skips to
 * the dashboard", and choosing a workspace is followed by *enabling organisations in it* —
 * which is a second step on this same screen, reached when the choice has already been
 * made. Without something in the request to tell them apart, the state that renders the
 * enablement list is exactly the state that redirects away from it.
 *
 * So the act of choosing redirects to `/login?workspace=<slug>`, and that parameter is the
 * difference between *arriving* signed in — which goes to the dashboard — and *being here
 * on purpose*, which is the second step. It is deliberately in the URL rather than in
 * state: it survives a refresh, it can be linked to, and it is visible in the address bar
 * rather than being hidden state that decides which screen somebody sees.
 *
 * The parameter is never trusted. It is compared against a membership the service reported
 * in this same request, so a hand-typed slug either names the workspace already chosen or
 * sends the visitor back to the choice.
 *
 * Its two imports are a pure module and a pair of types, so this file pulls nothing
 * server-only into the tests that cover it.
 */

import { type Membership, selectableMemberships } from "@/app/api/membership";
import type { Session, TenantSuggestion } from "@/app/api/identity";
import { LOGIN_PATH } from "@/app/paths";

/** The query parameter that says the second step is being asked for deliberately. */
export const WORKSPACE_PARAM = "workspace";

/** What the login screen renders for this request. */
export type LoginView =
  /** Nobody is signed in: step 1 is live and step 2 is the preview the mockup draws. */
  | { readonly step: "sign-in" }
  /** Signed in, belongs to at least one live workspace, has not settled on one. */
  | { readonly step: "choose"; readonly memberships: readonly Membership[] }
  /** Signed in, a workspace is chosen, and this is the enablement step in it. */
  | { readonly step: "enable"; readonly membership: Membership }
  /**
   * Signed in and a member of nowhere — either genuinely new, or holding only workspaces
   * that are suspended. There is nothing to choose, so the screen explains rather than
   * offering an empty list.
   */
  | {
      readonly step: "no-workspace";
      readonly suggestion: TenantSuggestion | null;
      readonly memberships: readonly Membership[];
    }
  /** Signed in and settled: this request belongs on the dashboard, not here. */
  | { readonly step: "dashboard" };

/** The request, as much of it as this decision depends on. */
export interface LoginRequest {
  /** The session, or `null` when the request carries none. */
  readonly session: Session | null;
  /** The active workspace, already resolved against that session. */
  readonly membership: Membership | undefined;
  /** The `?workspace=` parameter, if the URL carried exactly one. */
  readonly workspace: string | undefined;
}

/**
 * Decide what the login screen shows.
 *
 * @param request The session, the active workspace, and the `?workspace=` parameter.
 * @returns The view to render — or `{step: "dashboard"}`, which is the page's instruction
 *   to redirect rather than a thing to draw.
 */
export function loginView({ session, membership, workspace }: LoginRequest): LoginView {
  if (session === null) {
    return { step: "sign-in" };
  }

  const selectable = selectableMemberships(session.memberships);

  if (selectable.length === 0) {
    return {
      step: "no-workspace",
      suggestion: session.tenantSuggestion,
      // The full list, not the selectable one: it is empty by definition here, and a
      // person holding only suspended workspaces is owed the reason rather than a blank.
      memberships: session.memberships,
    };
  }

  if (membership === undefined) {
    return { step: "choose", memberships: selectable };
  }

  if (workspace === membership.slug) {
    return { step: "enable", membership };
  }

  // A parameter naming a *different* workspace this person belongs to is a switch, and a
  // switch is a choice — so it goes back to the list rather than silently re-pointing the
  // cookie from a GET. Anything else (no parameter, or a slug that names nothing) is an
  // ordinary arrival by somebody who has already settled.
  if (workspace !== undefined && selectable.some((one) => one.slug === workspace)) {
    return { step: "choose", memberships: selectable };
  }

  return { step: "dashboard" };
}

/**
 * The URL of the enablement step for one workspace.
 *
 * One place composes it, so the parameter name is written once and the redirect after a
 * choice cannot drift from the check in {@link loginView}.
 *
 * @param slug The workspace's slug.
 * @returns The path, with the workspace named.
 */
export function enablementPath(slug: string): string {
  return `${LOGIN_PATH}?${WORKSPACE_PARAM}=${encodeURIComponent(slug)}`;
}
