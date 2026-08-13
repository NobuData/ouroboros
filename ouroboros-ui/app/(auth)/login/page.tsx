import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { currentAccess } from "@/app/api/access";
import { readEnablement } from "@/app/api/enablement";
import { LoginScreen, type LoginScreenState } from "@/app/login/login-screen";
import { WORKSPACE_PARAM, type LoginView, loginView } from "@/app/login/view";
import { DASHBOARD_PATH, RETURN_TO_PARAM, safeReturnTo } from "@/app/paths";

/**
 * `/login` — the front door (#44).
 *
 * The route is thin on purpose, the way `app/(app)/layout.tsx` is: it reads the request,
 * hands the three values that decide anything to a pure function
 * (`app/login/view.ts`), fetches only for the one step that needs data, and renders a
 * component (`app/login/login-screen.tsx`). Everything with a decision in it is therefore
 * testable without a router, and everything with markup in it without a request.
 *
 * It is a Server Component because every *read* this screen makes is server-side by
 * construction (`app/api/server.ts`): the session cookie is `HttpOnly` and the service's
 * address carries no `NEXT_PUBLIC_` prefix. The writes are Server Actions
 * (`app/login/actions.ts`). The one client component is `app/login/sign-in-button.tsx`,
 * which exists because beginning a sign-in is a `POST` whose answer the *browser* then
 * navigates to — see that file, and #702.
 *
 * Reading `searchParams` and the cookies makes the route dynamic, which is correct and not
 * incidental: a page whose content depends on who is asking cannot be prerendered, and
 * `next build` must not try — `OURO_REST_URL` is a runtime value and a build machine has no
 * reason to know the address of a service it is not calling.
 *
 * **It is also where a `?next=` lands** ([#716](https://github.com/NobuData/ouroboros/issues/716)).
 * A `401` sends a request here carrying where it was going, and a screen that always finished
 * on the dashboard would drop that on the floor — so a visitor who arrives with one and turns
 * out to be settled goes back to the page they asked for instead. The parameter is never
 * trusted: `safeReturnTo` accepts only a path on this origin, because a link carrying
 * `?next=https://evil.test` would otherwise hand a freshly signed-in visitor to somebody
 * else's page.
 */

export const metadata: Metadata = {
  title: "Sign in · Ouroboros",
  description: "Sign in to Ouroboros and choose the workspace the loop runs in.",
};

/** What Next.js hands a page for the query string. */
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * The login screen.
 *
 * @param props.searchParams The query string, as a promise — a request-time value in this
 *   version of Next.js. `workspace` names the step-2 workspace; `next` is where a `401` came
 *   from.
 * @returns The screen, or — for somebody who has already settled — a redirect to wherever
 *   they were heading, and to the dashboard when that was nowhere in particular.
 */
export default async function LoginPage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const parameters = await searchParams;
  const { session, membership } = await currentAccess();
  const view = loginView({
    session,
    membership,
    workspace: single(parameters[WORKSPACE_PARAM]),
  });

  if (view.step === "dashboard") {
    redirect(safeReturnTo(single(parameters[RETURN_TO_PARAM])) ?? DASHBOARD_PATH);
  }

  return <LoginScreen state={await state(view)} user={session?.user ?? null} />;
}

/**
 * Read one query parameter, refusing a repeated one.
 *
 * `?workspace=a&workspace=b` arrives as an array, and there is no right answer to which of
 * the two was meant — so it is treated as no parameter at all, which lands on the workspace
 * choice. Guessing would mean a URL that quietly configures a workspace nobody named.
 *
 * @param value What Next.js parsed for one key.
 * @returns The single value, or `undefined` when it is absent or repeated.
 */
function single(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * Turn the decided view into the screen's state, fetching for the one step that needs it.
 *
 * The enablement step is the only one that reads anything beyond the session, and it reads
 * it *after* the workspace has been resolved against the session's memberships — so the
 * tenant id in those requests came from the service in this same request rather than from
 * the URL.
 *
 * @param view What `loginView` decided, never the `dashboard` outcome.
 * @returns The screen's state, complete.
 * @throws {ApiError} What `ouroboros-rest` answered to the enablement read.
 */
async function state(view: Exclude<LoginView, { step: "dashboard" }>): Promise<LoginScreenState> {
  if (view.step !== "enable") {
    return view;
  }

  return {
    step: "enable",
    membership: view.membership,
    enablement: await readEnablement(view.membership.tenantId),
  };
}
