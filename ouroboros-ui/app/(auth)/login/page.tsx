import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { currentAccess } from "@/app/api/access";
import { workspaceHint } from "@/app/api/server";
import { LoginScreen } from "@/app/login/login-screen";
import { WORKSPACE_PARAM, loginView } from "@/app/login/view";
import { DASHBOARD_PATH, RETURN_TO_PARAM, safeReturnTo } from "@/app/paths";

/**
 * `/login` — the front door (#44).
 *
 * The route is thin on purpose, the way `app/(app)/layout.tsx` is: it reads the request,
 * hands the three values that decide anything to a pure function
 * (`app/login/view.ts`), and renders a component (`app/login/login-screen.tsx`). Everything
 * with a decision in it is therefore testable without a router, and everything with markup
 * in it without a request.
 *
 * **It fetches nothing of its own since
 * [#719](https://github.com/NobuData/ouroboros/issues/719)**, where it used to read the
 * chosen workspace's organisations and repositories for step 2. The workspace rows are part
 * of the session now — `GET /api/v1/orgs` answers them with the counts and roles together
 * (`app/api/auth-server.ts`) — so the decision and the data arrive in the same read, and the
 * three values below are the whole of the request's state.
 *
 * It is a Server Component because every *read* this screen makes is server-side by
 * construction (`app/api/server.ts`): the session cookie is `HttpOnly` and the service's
 * address carries no `NEXT_PUBLIC_` prefix. The submissions are Server Actions
 * (`app/login/actions.ts`), and step 2 is Server Components the whole way down — its switches
 * are submit buttons in one-field forms, so they work before hydration and without JavaScript.
 *
 * **Step 1 has three client components, and each one is a different reason**
 * ([#718](https://github.com/NobuData/ouroboros/issues/718)). Two of them are the same
 * reason, and it is BetterAuth's `Set-Cookie`: a session cookie reaches a browser only on a
 * request the browser itself made, so *every* sign-in on this screen is a call from the
 * client and not from an action.
 *
 * | Component | Why it cannot be a Server Component |
 * |---|---|
 * | `sign-in-button.tsx` | the answer is a URL the *browser* navigates to (#702) |
 * | `dev-sign-in.tsx` | the session cookie is set on the browser's own request (#705) |
 * | `sso-form.tsx` | the call is a Server Action; **rendering what it returned** is not |
 *
 * The third is the only one that is a rendering decision rather than a transport one, and
 * that file says at length why the alternatives — a `redirect()` carrying the message, a
 * search parameter — are worse than one `useActionState`.
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
  const { session } = await currentAccess();
  const view = loginView({
    session,
    workspace: single(parameters[WORKSPACE_PARAM]),
    settled: (await workspaceHint()) !== undefined,
  });

  if (view.step === "dashboard") {
    redirect(safeReturnTo(single(parameters[RETURN_TO_PARAM])) ?? DASHBOARD_PATH);
  }

  return <LoginScreen state={view} user={session?.user ?? null} />;
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
