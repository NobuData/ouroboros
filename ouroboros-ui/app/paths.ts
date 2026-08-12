/**
 * The routes this application redirects to, written down once.
 *
 * Three modules need to agree about them and none of them can import the others: the API
 * client's `401` handling sends a request to the login screen (`app/api/server.ts`), the
 * login screen decides when to send one to the dashboard instead (`app/login/view.ts`), and
 * the Server Actions behind that screen redirect to both. A string typed out three times is
 * a redirect loop waiting for one of them to be renamed.
 *
 * Framework-free and value-only, the same way `app/api/tenant.ts` is: a pure view decision
 * and a server-only client both read from here, so nothing in it may pull `next/*` into a
 * bundle that has no business with it.
 *
 * Named `paths.ts` rather than `routes.ts` deliberately — `route.ts` is a Next.js file
 * convention, and a file one letter away from it inside `app/` is a file somebody will
 * eventually mistake for a route handler.
 */

/** The sign-in and tenancy screen (#44) — where a request with no usable session goes. */
export const LOGIN_PATH = "/login";

/**
 * The dashboard (#45) — where a signed-in request with a chosen workspace belongs.
 *
 * A segment of its own rather than `/`, which is what it was while the placeholder stood
 * there: the sidebar highlights the entry whose route the URL is under
 * (`app/shell/nav.ts`), and a module whose route is `/` is a module that matches nothing or
 * everything. `/` redirects here, so nothing that already pointed at it broke.
 */
export const DASHBOARD_PATH = "/dashboard";
