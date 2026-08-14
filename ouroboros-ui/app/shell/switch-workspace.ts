"use client";

import { organization, unwrap } from "@/app/api/auth-client";

/**
 * Moving the session into another workspace — the one call, made from the two places that
 * offer it ([#77](https://github.com/NobuData/ouroboros/issues/77)).
 *
 * The account menu has offered it since CP.3 and the tenant chip offers it now, which is what
 * the design system asks for (§ 1.1 draws the chip as the switcher and the profile menu with
 * a workspace section) and is exactly the situation a shared function is for: two surfaces,
 * one write, and **one sentence for a refusal**. A message written out twice is two messages
 * the day one of them is improved.
 *
 * ### Why the browser makes this call and a Server Action does not
 *
 * `app/shell/actions.ts` sets out the argument in full — in one line, it is which side of the
 * wire can write the cookie each write has to change. BetterAuth's refreshed `session_data`
 * cookie has to reach the browser that asked for it, and the organization plugin's own stores
 * invalidate on the way back, so every component reading `useSession()` or
 * `useListOrganizations()` redraws with no code in any of them to keep it in step.
 *
 * What that does *not* carry is the server: the route's Server Components are scoped by
 * `session."activeOrganizationId"` (#713) and know nothing about a call the browser made. The
 * caller is what closes that gap, with `router.refresh()` — which re-renders them without a
 * navigation, and is the issue's *"repaints dashboard data without a full page reload"* in
 * the framework's own words. It is left to the caller rather than done here because this
 * module must not import `next/navigation`: a router is a caller's, and a shared write that
 * navigated would be one the two menus could not sequence differently.
 */

/** What is said when the service refuses and gives nothing a person could read. */
export const SWITCH_FAILURE = "That workspace could not be opened.";

/**
 * Make the session act in another workspace.
 *
 * @param organizationId The workspace to move to — BetterAuth's organization id.
 * @returns `null` when the switch landed, or the sentence to show when it did not. A refusal
 *   is a value rather than a throw because it is **a state to render**: the menu is chrome,
 *   and replacing every screen because one workspace could not be opened would lose the
 *   screen the reader is still entitled to be on.
 */
export async function switchWorkspace(organizationId: string): Promise<string | null> {
  try {
    unwrap(await organization.setActive({ organizationId }), "/organization/set-active");
  } catch (error) {
    return error instanceof Error && error.message !== "" ? error.message : SWITCH_FAILURE;
  }

  return null;
}
