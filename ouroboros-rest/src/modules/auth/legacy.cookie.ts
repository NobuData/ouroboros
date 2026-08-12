/**
 * Evicting `ouro_session` — the cookie
 * [#33](https://github.com/NobuData/ouroboros/issues/33) issued and nothing honours any
 * more.
 *
 * [#703](https://github.com/NobuData/ouroboros/issues/703) swapped the session mechanism
 * under browsers that are already holding one. There is no way to migrate a stateless
 * signed cookie into a `session` row — the row was never written, and inventing one from a
 * cookie would mean trusting the very signature the swap exists to stop trusting — so
 * **every live session is invalidated by this change**. That is intended, and it is called
 * out in the release note rather than discovered.
 *
 * What is left over is a browser that goes on sending a cookie no code reads. Left alone
 * that is merely untidy; the acceptance criterion is stricter, and rightly so — *a stale
 * `ouro_session` cookie is rejected cleanly (401 + clear-cookie), not 500*. The `401` comes
 * free: the guard resolves a session from BetterAuth's cookie, finds none, and refuses. The
 * clear-cookie is this file.
 *
 * ## Why middleware, and why unconditionally
 *
 * It is not a `401` handler. `ouro_session` is dead on *every* request — a `200` from the
 * heartbeat carrying one is the same stale cookie as a `401` from the tenancy API — so the
 * rule is "if you sent it, you are told to drop it", which is a property of the request
 * rather than of the answer. That makes it middleware: one place, before any guard, no
 * exception filter to chain and no status to inspect.
 *
 * Nest middleware never sees BetterAuth's own routes, and that is fine rather than a gap:
 * `@thallesp/nestjs-better-auth` registers its handler on the HTTP adapter during
 * `onModuleInit`, ahead of the middleware Nest installs at `init()`, and it answers without
 * calling `next()`. A browser holding a stale cookie is cleared of it by the first request
 * it makes to anything else, which on a page load is immediate.
 *
 * ## This file is temporary, and says so
 *
 * Once no browser can still be holding a seven-day cookie issued before the cut-over, this
 * module and its registration are a deletion of about twenty lines. It is dated rather than
 * open-ended for that reason: {@link LEGACY_SESSION_MAX_AGE_SECONDS} is how long "still
 * possible" lasts.
 */

import { Injectable, type NestMiddleware } from "@nestjs/common";

import { AppConfigService } from "../config/config.service";
import { appendSetCookie, COOKIE, type AuthRequest, type AuthResponse } from "./http";

/**
 * The name of the cookie #33 issued.
 *
 * Written out rather than imported, because the module that used to export it —
 * `session.ts` — is what this issue deleted. A constant naming a thing that no longer
 * exists is the correct shape for an eviction: it is the last reference in the codebase.
 */
export const LEGACY_SESSION_COOKIE = "ouro_session";

/**
 * How long the cookie being evicted could still be in a browser, in seconds — seven days.
 *
 * #33's `SESSION_MAX_AGE_SECONDS`, restated here as the expiry date of this module rather
 * than as a session lifetime: a week after the cut-over deploys, no browser can be holding
 * one that a browser would still send, and this file can go.
 */
export const LEGACY_SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

/**
 * The `Set-Cookie` that removes it.
 *
 * `Max-Age=0` with an empty value is the removal a browser acts on, and the attributes
 * have to match the ones it was *set* with closely enough to name the same cookie —
 * `Path=/` above all, since a removal on a different path leaves the original in place.
 * `HttpOnly` and `SameSite=Lax` are #33's, restated; `Secure` is conditional for the same
 * reason it was then, which is that development is plain HTTP on loopback and a cookie
 * refusing to travel there removes nothing.
 *
 * @param isProduction - Whether this deployment is production, from `AppConfigService`.
 * @returns The header value.
 */
export function expiredLegacyCookie(isProduction: boolean): string {
  return [
    `${LEGACY_SESSION_COOKIE}=`,
    "Path=/",
    "Max-Age=0",
    "HttpOnly",
    "SameSite=Lax",
    ...(isProduction ? ["Secure"] : []),
  ].join("; ");
}

/**
 * Is this request carrying the cookie #33 issued?
 *
 * @param header - The request's `Cookie` header, or `undefined`.
 * @returns Whether the header names {@link LEGACY_SESSION_COOKIE}. Matched with its
 *   delimiter — `ouro_session=` after a boundary — rather than by substring, so a cookie
 *   called `not_ouro_session` or `ouro_session_backup` is not mistaken for it and does not
 *   earn every response a header it does not need.
 */
export function carriesLegacyCookie(header: string | undefined): boolean {
  if (header === undefined) {
    return false;
  }

  return header
    .split(";")
    .some((entry) => entry.trimStart().startsWith(`${LEGACY_SESSION_COOKIE}=`));
}

/**
 * Tell a browser to drop `ouro_session`, whenever it sends one.
 *
 * Registered for every route in `auth.module.ts`.
 */
@Injectable()
export class LegacySessionCookieMiddleware implements NestMiddleware {
  /**
   * @param config - For whether `Secure` goes on the removal.
   */
  constructor(private readonly config: AppConfigService) {}

  /**
   * Add the removal when the request carried the cookie, and nothing otherwise.
   *
   * @param request - The incoming request.
   * @param response - The answer being built. Appended to rather than overwritten — see
   *   `appendSetCookie`, which is where that matters.
   * @param next - The rest of the pipeline. Always called: this middleware refuses nothing
   *   and delays nothing, and a stale cookie is a `401` because the guard says so rather
   *   than because this did.
   */
  use(request: AuthRequest, response: AuthResponse, next: () => void): void {
    const header = request.headers?.[COOKIE];

    if (typeof header === "string" && carriesLegacyCookie(header)) {
      appendSetCookie(response, [expiredLegacyCookie(this.config.isProduction)]);
    }

    next();
  }
}
