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
 * Model routing ([#200](https://github.com/NobuData/ouroboros/issues/200)) — mockup 06.
 *
 * Written down here for the reason every other route in this file is: three modules have to
 * agree about it and none of them can import the others. The sidebar's registry entry
 * (`app/shell/nav-modules.ts`) names it as the **Models** destination, the section's tab set
 * links its Routing tab to it (`app/models/models-subnav.tsx`), and `isActiveRoute` in
 * `app/shell/nav.ts` matches the URL against it — including everything beneath it, so the
 * sub-surfaces the tab set names keep **Models** highlighted. {@link PROVIDERS_PATH} is the
 * first of them to arrive.
 */
export const MODELS_PATH = "/models";

/**
 * Providers & keys ([#227](https://github.com/NobuData/ouroboros/issues/227)) — mockup 07.
 *
 * **Spelled from {@link MODELS_PATH} rather than beside it, and that is the point.** The
 * sidebar highlights the entry whose route the URL is under, so a providers page at
 * `/providers` would be a Models surface on which the **Models** entry went dark. Under
 * `/models` it stays lit on both pages, which is the ticket's *both directions* criterion met
 * by the URL rather than by a special case in the sidebar.
 *
 * The Models tab set (`app/models/models-subnav.tsx`) links here and links back to
 * `MODELS_PATH` from the same list, so the two pages cannot disagree about where the other
 * one is. The Workspace Settings roadmap (decision S2,
 * [#491](https://github.com/NobuData/ouroboros/issues/491)) relocates this surface's
 * *navigation entry* under `/settings` when that section arrives; the route is written down
 * once so that move is one edit.
 */
export const PROVIDERS_PATH = `${MODELS_PATH}/providers`;

/**
 * The model registry ([#591](https://github.com/NobuData/ouroboros/issues/591)) — mockup 21.
 *
 * The third Models surface, and spelled from {@link MODELS_PATH} for the reason
 * {@link PROVIDERS_PATH} is: the sidebar highlights the entry whose route the URL is under, so
 * a registry at `/registry` would be a Models surface on which the **Models** entry went dark.
 * Under `/models` it stays lit on all three pages — the ticket's *all three directions*
 * criterion (06 ⇄ 21 ⇄ 07) met by the URL rather than by a special case in the sidebar.
 *
 * Roadmap decision **R10** names the route, and the Models tab set
 * (`app/models/models-subnav.tsx`) links here from the same list it links the other two from,
 * so no two pages of the section can disagree about where the third one is.
 */
export const REGISTRY_PATH = `${MODELS_PATH}/registry`;

/**
 * The routing matrix's heading, as an element id — where a **Used by** chip naming a route
 * goes ([#593](https://github.com/NobuData/ouroboros/issues/593)).
 *
 * Written down here for the same reason every route above is: two modules have to agree about
 * it and neither can import the other. `app/models/routing-matrix.tsx` renders it as the card's
 * `aria-labelledby` target, and the registry inspector links to it — so the link and its target
 * are one string rather than two literals that a rename would part.
 *
 * A **fragment** rather than the matrix's own `?route=` selection, deliberately: that parameter
 * names a *task kind*, and a reference carries the referring hop's id and its chip label, from
 * neither of which a kind may be guessed.
 */
export const ROUTING_MATRIX_HASH = "models-matrix-title";

/**
 * The escalation-rules card's heading, likewise — where a chip naming a rule goes.
 *
 * `app/models/rules-card.tsx` renders it.
 */
export const ROUTING_RULES_HASH = "models-rules-title";

/**
 * The query parameter carrying where a visitor was heading when they were sent to sign in.
 *
 * Added by [#716](https://github.com/NobuData/ouroboros/issues/716): a `401` routes to the
 * login screen, and a login screen that always lands on the dashboard afterwards loses the
 * request that was actually being made.
 */
export const RETURN_TO_PARAM = "next";

/**
 * The query parameter that names one alias on the registry page.
 *
 * Written by the provider card's *not listed upstream* flag
 * ([#230](https://github.com/NobuData/ouroboros/issues/230)), which links to the alias whose
 * route a vanished model has broken. The registry's alias table (CI.2–CI.5) is what will
 * honour it; until then the link lands on the registry page, which is where the alias lives.
 */
export const ALIAS_PARAM = "alias";

/**
 * The registry page, opened on one alias.
 *
 * @param alias The alias's name.
 * @returns The path, with the name encoded.
 */
export function aliasPath(alias: string): string {
  return `${REGISTRY_PATH}?${ALIAS_PARAM}=${encodeURIComponent(alias)}`;
}

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
