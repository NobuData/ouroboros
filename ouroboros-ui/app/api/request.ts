/**
 * Where this request was going — the one fact about a request that a Server Component
 * cannot read for itself.
 *
 * Every server-side redirect to the login screen wants the same thing: *come back here
 * afterwards*. `app/paths.ts` has had the vocabulary for it since
 * [#716](https://github.com/NobuData/ouroboros/issues/716) — `loginPath(returnTo)` and the
 * `safeReturnTo` guard under it — and `app/(auth)/login/page.tsx` has honoured `?next=`
 * since the same change. What was missing was the value: **Next.js publishes no way for a
 * Server Component, a Server Action or a Route Handler to learn the URL it is running for**,
 * so the three server-side redirects sent a bare `/login` and the browser's own client
 * (`app/api/auth-client.ts`) was the only caller that could fill the parameter in.
 *
 * `proxy.ts` is the one place in this application that *does* see the URL, and this module
 * is the two ends of the wire between them: the header it stamps, and the read back.
 *
 * ### This is a fact being passed, not a decision being made
 *
 * That distinction is the whole of the middleware decision
 * [#720](https://github.com/NobuData/ouroboros/issues/720) records, and `proxy.ts` § *Why
 * this file is not the auth gate* is where it is written down. Nothing here is consulted
 * about **whether** a request may proceed — `app/api/access.ts` remains the only answer to
 * that — and a request that arrives with no header at all is redirected exactly as it was
 * before, to a bare `/login`. The header decides where somebody lands *after* signing in,
 * and nothing else.
 *
 * Which is also why a forged one is uninteresting. The value travels in a request header, so
 * a caller can send whatever it likes; `proxy.ts` overwrites it with `set` on every request
 * it matches, and {@link loginDestination} passes what survives through `safeReturnTo`,
 * which accepts only a path on this origin. The worst a value that got past both could do is
 * send the person who sent it to a page of this product.
 *
 * Framework-shaped but not `server-only`, and the exception is deliberate: `proxy.ts` reads
 * {@link REQUEST_PATH_HEADER} from here, and proxy is server-side code that is not a Server
 * Component — the marker package throws for it. The `next/headers` import below is its own
 * guard, since a Client Component that reached for it gets the framework's error by name.
 */

import { headers } from "next/headers";

import { loginPath } from "@/app/paths";

/**
 * The header `proxy.ts` stamps the request's own address onto.
 *
 * `x-ouro-` like `X-Ouro-Tenant` (`app/api/tenant.ts`), because it is this product's own
 * rather than anything the contract or BetterAuth describes. Lower-case because that is how
 * a `Headers` instance normalises it and how a test reads it back; header names are
 * case-insensitive either way.
 */
export const REQUEST_PATH_HEADER = "x-ouro-path";

/**
 * The path and query this request was made for, as `proxy.ts` saw it.
 *
 * @returns The address — `/dashboard`, `/runs?status=failed` — or `undefined` when the
 *   header is absent. Absent is an ordinary answer rather than a fault: `proxy.ts` does not
 *   match every path, and a caller reached from a context the proxy never saw simply has no
 *   return-to to offer.
 */
export async function requestPath(): Promise<string | undefined> {
  return (await headers()).get(REQUEST_PATH_HEADER) ?? undefined;
}

/**
 * The login screen, remembering where this request was heading.
 *
 * The one composition of {@link requestPath} and `loginPath`, so the three server-side
 * redirects — `requireWorkspace()` in `app/api/access.ts`, the `401` handlers in
 * `app/api/server.ts` and `app/api/auth-server.ts` — say the same thing in one call rather
 * than three copies of the same two lines.
 *
 * @returns `/login?next=…` when there is somewhere safe to return to, and a bare `/login`
 *   otherwise. `loginPath` is what decides which: it refuses anything that is not a path on
 *   this origin, and it refuses the login screen itself, so nothing composed here can bounce
 *   a visitor between that screen and itself.
 */
export async function loginDestination(): Promise<string> {
  return loginPath(await requestPath());
}
