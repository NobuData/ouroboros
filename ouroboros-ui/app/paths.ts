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
 * bundle that has no business with it. Since
 * [#716](https://github.com/NobuData/ouroboros/issues/716) the browser reads from here too —
 * the auth client's `401` handling is the one copy of this rule that runs client-side — which
 * is one more reason nothing framework-shaped may land in it.
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

/**
 * The query parameter carrying where a visitor was heading when they were sent to sign in.
 *
 * Added by [#716](https://github.com/NobuData/ouroboros/issues/716): a `401` routes to the
 * login screen, and a login screen that always lands on the dashboard afterwards loses the
 * request that was actually being made.
 */
export const RETURN_TO_PARAM = "next";

/**
 * The login screen, optionally remembering where to come back to.
 *
 * @param returnTo Where the visitor was heading, as a path on this origin. Anything
 *   {@link safeReturnTo} rejects — and `undefined` — produces the bare login path, so a
 *   caller never has to decide for itself whether its value is safe to pass on.
 * @returns `/login`, with `?next=…` when there is somewhere to return to.
 */
export function loginPath(returnTo?: string): string {
  const safe = safeReturnTo(returnTo);

  return safe === undefined
    ? LOGIN_PATH
    : `${LOGIN_PATH}?${RETURN_TO_PARAM}=${encodeURIComponent(safe)}`;
}

/**
 * Read a return-to value as somewhere this application may actually send a browser.
 *
 * **This is an open-redirect guard, and it is why the parameter is read through a function
 * rather than used where it is found.** The value arrives in a URL, so it is whatever anyone
 * cared to type: `https://evil.test/login` carried by a link that otherwise looks like this
 * product's own would hand a freshly signed-in visitor to somebody else's page. Only a path
 * on this origin is accepted, and the checks are made on the *raw string* rather than on a
 * parsed URL, because parsing is where the interesting cases hide — `//evil.test` is a
 * protocol-relative URL that `new URL(value, origin)` resolves to another host, and browsers
 * treat a backslash in that leading pair the same way.
 *
 * The login screen itself is refused too, so a return-to naming it cannot bounce a visitor
 * between the screen and itself.
 *
 * @param value The raw parameter, or `undefined` when there was none.
 * @returns The value unchanged when it is a path this origin may serve, or `undefined` when
 *   there is nothing safe to return to.
 */
export function safeReturnTo(value: string | undefined): string | undefined {
  if (value === undefined || value === "") return undefined;

  // One leading slash, and the character after it may not begin an authority.
  if (!value.startsWith("/")) return undefined;
  if (value.startsWith("//") || value.startsWith("/\\")) return undefined;

  // Control characters are refused outright: a browser strips a newline or a tab before it
  // resolves, so "/\nhttps://evil.test" would leave the origin while reading as a path here.
  if (hasControlCharacter(value)) return undefined;

  return value.split(/[?#]/, 1)[0] === LOGIN_PATH ? undefined : value;
}

/**
 * Whether a string carries a character a URL may not.
 *
 * Written as a scan rather than as a regular expression so the range is stated in code
 * points: a literal control character inside a pattern is invisible in a diff, which is the
 * one property a check like this must not have.
 *
 * @param value The string to scan.
 * @returns `true` when any character is C0 (`0x00`–`0x1f`), space, or delete (`0x7f`).
 */
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x20 || code === 0x7f) return true;
  }

  return false;
}
