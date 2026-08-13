/**
 * What the login screen shows, decided from three values and nothing else.
 *
 * The screen has one route and four outcomes, and keeping the choice between them in a
 * pure function is what makes each one something a test can name: the page reads the
 * request, this decides, and the components render. Nothing here touches the framework,
 * the network or a cookie.
 *
 * The three inputs are the whole of the request's state:
 *
 * | | |
 * |---|---|
 * | `session` | who is signed in, what they belong to, and where the session is acting |
 * | `workspace` | the `?workspace=` slug in the URL — the marker that says *I came back on purpose* |
 * | `settled` | whether this browser has been through step 2 before (`app/api/server.ts`) |
 *
 * ### Why "have they chosen?" is not the same question as "which workspace?"
 *
 * It used to be. The active workspace was the `ouro_tenant` cookie, and a freshly signed-in
 * visitor had none — so *no cookie* meant *has not chosen yet*, and step 2 was what the
 * absence of a value rendered.
 *
 * [#719](https://github.com/NobuData/ouroboros/issues/719) moved the workspace onto the
 * session, and the two questions came apart: `ouroboros-rest` stamps
 * `session."activeOrganizationId"` at session creation
 * (`src/auth/active.organization.ts`), precisely so that Step 2 opens on a row already
 * selected and **Enter mission control →** has somewhere to go. So *every* signed-in request
 * names a workspace, including the first one after a sign-in, and a screen that read the
 * pointer as evidence of a choice would send everybody straight past the question it exists
 * to ask.
 *
 * `settled` is the fact the pointer no longer carries. It is a hint in a cookie, it
 * authorizes nothing, and the worst a forged one can do is skip a step the person could have
 * skipped by typing `/dashboard` — which is exactly the weight the answer deserves.
 *
 * ### Why the URL carries a marker at all
 *
 * The same reason it did before: "an authenticated visitor skips to the dashboard" and "a
 * signed-in person may come back and change where the loop runs" are the same request
 * otherwise. `?workspace=<slug>` is the difference between *arriving* settled — which goes
 * to the dashboard — and *being here on purpose*, which is step 2 with that workspace's row
 * selected.
 *
 * It is deliberately in the URL rather than in state: it survives a refresh, it can be
 * linked to, and it is visible in the address bar rather than being hidden state that
 * decides which screen somebody sees. It is never trusted — it is compared against the
 * memberships the service reported in this same request, so a hand-typed slug either names a
 * workspace this person belongs to or is ignored.
 *
 * Its two imports are a pure module and a pair of types, so this file pulls nothing
 * server-only into the tests that cover it.
 */

import { type Membership, activeMembership } from "@/app/api/membership";
import type { Session, TenantSuggestion } from "@/app/api/identity";

/** The query parameter that says step 2 is being asked for deliberately. */
export const WORKSPACE_PARAM = "workspace";

/** What the login screen renders for this request. */
export type LoginView =
  /** Nobody is signed in: step 1 is live and step 2 is the preview the mockup draws. */
  | { readonly step: "sign-in" }
  /**
   * Signed in, belongs to at least one workspace: **the mockup's step 2**, with every
   * workspace as a row and one of them selected.
   */
  | {
      readonly step: "choose";
      /** The workspaces to draw, in the order the service returned them — oldest first. */
      readonly memberships: readonly Membership[];
      /** Which row starts selected. Present whenever there is a row to select. */
      readonly active: Membership | undefined;
      /** How many exist in total, which may exceed what {@link LoginView.memberships} holds. */
      readonly total: number;
    }
  /**
   * Signed in and a member of nowhere. There is nothing to choose, so the screen explains
   * rather than offering an empty list.
   */
  | { readonly step: "no-workspace"; readonly suggestion: TenantSuggestion | null }
  /** Signed in and settled: this request belongs on the dashboard, not here. */
  | { readonly step: "dashboard" };

/** The request, as much of it as this decision depends on. */
export interface LoginRequest {
  /** The session, or `null` when the request carries none. */
  readonly session: Session | null;
  /** The `?workspace=` parameter, if the URL carried exactly one. */
  readonly workspace: string | undefined;
  /** Whether this browser has already been through step 2. */
  readonly settled: boolean;
}

/**
 * Decide what the login screen shows.
 *
 * @param request The session, the `?workspace=` parameter, and the step-2 hint.
 * @returns The view to render — or `{step: "dashboard"}`, which is the page's instruction
 *   to redirect rather than a thing to draw.
 */
export function loginView({ session, workspace, settled }: LoginRequest): LoginView {
  if (session === null) {
    return { step: "sign-in" };
  }

  const { memberships, membershipTotal, activeOrganizationId } = session;

  if (memberships.length === 0) {
    return { step: "no-workspace", suggestion: session.tenantSuggestion };
  }

  const named = activeMembership(memberships, workspace);
  const acting = activeMembership(memberships, activeOrganizationId ?? undefined);

  // Both halves are required, and the second is not a formality: a session may point at a
  // workspace this person has since been removed from, and `requireWorkspace()` would send
  // that request straight back here — a redirect loop between two screens each certain the
  // other should have it. Resolving the pointer first is what makes the dashboard reachable
  // only when the dashboard will actually render.
  //
  // A marker naming a workspace they belong to beats both, because somebody who followed a
  // link to change where the loop runs is asking for the question rather than for the answer
  // they gave last time.
  if (named === undefined && settled && acting !== undefined) {
    return { step: "dashboard" };
  }

  return {
    step: "choose",
    memberships,
    // The marker first, then the session's own pointer, then the first row — so the card
    // always opens on something, which is what makes **Enter mission control →** a single
    // press for the person who has nothing to change.
    active: named ?? acting ?? memberships[0],
    total: membershipTotal,
  };
}
