/**
 * How this suite arrives signed in — and why, for the moment, it cannot.
 *
 * ## What this used to be
 *
 * Issue [#56](https://github.com/NobuData/ouroboros/issues/56) asks for a *dev-auth login*
 * leg. The stack it runs against would not serve one — `ouroboros-rest`'s image pins
 * `NODE_ENV=production`, and production is where `loadConfiguration` *deleted*
 * `OURO_AUTH_DEV_USER` before the schema ever saw it — so this module minted a session the
 * way the service minted one: `issueSession()`, imported from `ouroboros-rest`'s own
 * source, signed with the `OURO_SESSION_SECRET` the running container held. Every check the
 * guard made still ran. It was a legitimately signed credential rather than a bypass, and
 * that distinction is what made it acceptable.
 *
 * ## Why it is parked
 *
 * [#703](https://github.com/NobuData/ouroboros/issues/703) retired that session. There is
 * no `issueSession` any longer and no signing key it could use: a session is now a **row**
 * in `ouroboros.session`, and a cookie names it. Nothing about that is reproducible from
 * outside the stack, and two things have to land before it is:
 *
 *   * **[#709](https://github.com/NobuData/ouroboros/issues/709)** — the development seed
 *     does not yet write BetterAuth's `"user"` rows, so the seeded owner this suite signs
 *     in as has no identity for a session to reference at all.
 *   * **[#705](https://github.com/NobuData/ouroboros/issues/705)** — the development
 *     email/password sign-in, which is what gives a scripted caller an honest way to obtain
 *     a session over HTTP. [#715](https://github.com/NobuData/ouroboros/issues/715) is the
 *     issue that then builds the automated auth suite on top of it.
 *
 * The alternatives were weighed and rejected. Reaching into PostgreSQL from here — to
 * insert a `"user"` and a `session` row — would break the rule this directory is built on,
 * which is that everything reaches a service over HTTP; `eslint.config.mjs` enforces the
 * import half of it, and the single exception it used to permit is what this file has just
 * lost. Walking the real GitHub handshake needs a human at a consent screen.
 *
 * So the legs that need a session are annotated `test.fixme` with {@link SESSION_PARKED}
 * as the reason, and they say so in the run's report rather than failing every night at
 * three. **Every leg that does not need one still runs**, which is most of the health,
 * shell and negative-path coverage — including, importantly, the assertions that a stranger
 * is refused.
 *
 * ## What replaces this
 *
 * One function. When #705 lands, {@link signIn} becomes a call to its sign-in route and no
 * spec changes — none of them know how the cookie got there.
 */

import type { BrowserContext } from "@playwright/test";

/**
 * Why the signed-in legs do not run, in the words a report should carry.
 *
 * A constant rather than a string per call site, so that the day it stops being true there
 * is one place to delete and `grep` finds every leg that was waiting on it.
 */
export const SESSION_PARKED =
  "Signing in needs #709 (the seed writes BetterAuth's user rows) and #705 (development " +
  "email/password sign-in). #703 replaced the stateless cookie this suite used to mint " +
  "with a database-backed session row, which cannot be produced from outside the stack.";

/**
 * The cookie a signed-in browser carries.
 *
 * Named here because the specs that assert a session is *checked* still set one — a value
 * naming no row, which is the post-#703 form of "a forged credential authenticates
 * nobody". Those legs need no minting and do still run.
 */
export const SESSION_COOKIE = "better-auth.session_token";

/**
 * Sign a browser context in as a seeded user.
 *
 * @param _context - The context that would carry the session.
 * @param _userId - Whose session, from `support/seed.ts`.
 * @returns Never; see {@link SESSION_PARKED}.
 * @throws {Error} Always. A leg that reaches this has lost its `test.fixme` annotation,
 *   and failing loudly here is better than a browser that silently proceeds signed out and
 *   then fails on a heading that is not there.
 */
export function signIn(_context: BrowserContext, _userId: string): Promise<never> {
  return Promise.reject(new Error(SESSION_PARKED));
}

/**
 * Mint a session for a seeded user.
 *
 * @param _userId - Whose session.
 * @returns Never; see {@link SESSION_PARKED}.
 * @throws {Error} Always, for the reason {@link signIn} gives.
 */
export function mintSession(_userId: string): never {
  throw new Error(SESSION_PARKED);
}
