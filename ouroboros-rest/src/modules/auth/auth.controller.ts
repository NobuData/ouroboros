/**
 * `/api/v1/auth` — find out who you are, and sign out.
 *
 * The controller names routes and shapes and hands the rest to `AuthService`, exactly as
 * every tenancy controller does. `POST logout` is the one route here that is not the API's
 * usual JSON-in, JSON-out shape: it answers `204`, because there is nothing to say and the
 * `Set-Cookie` that removes the session is the whole of the answer.
 *
 * ---
 *
 * **Signing in is not here any more, and is not forwarded from here either.**
 * [#702](https://github.com/NobuData/ouroboros/issues/702) retired #33's flow, and this is
 * where the issue's third bullet — *forward to `/api/auth/*`, or remove* — was decided:
 * `GET github` and `GET github/callback` are **removed**. Two reasons, and the first is
 * mechanical:
 *
 *   * **There is nothing to forward to.** BetterAuth begins a social sign-in at
 *     `POST /api/auth/sign-in/social`, which answers `200` with the provider's authorization
 *     URL in a JSON body for the caller to follow. A `GET` that `302`-ed to it would send a
 *     browser to a route that does not answer `GET`, and one that redirected to github.com
 *     itself would mean composing the `state` here — which is the handshake this issue
 *     exists to stop implementing twice.
 *   * **The callback is registered on github.com, not chosen by us.** It is
 *     `${BETTER_AUTH_URL}/api/auth/callback/github` now. A shim under `/api/v1` would be a
 *     URL nothing redirects to, kept alive so that a route table looks unchanged.
 *
 * So the sign-in surface moved wholesale, and `ouroboros-ui` re-points at it in
 * [#718](https://github.com/NobuData/ouroboros/issues/718) — which is the interval in which
 * the login page's GitHub button does not work. That is a real gap and it is deliberate:
 * the alternative is two sign-in paths in one service, which is the failure mode #702 was
 * written to prevent. `src/auth/auth.routes.ts` is where the replacement routes are
 * written down.
 *
 * ---
 *
 * Of the two routes left, one is `@Public()` and one deliberately is not. `GET me` is the
 * route that answers *who is signed in*, so it is the one that must require being signed
 * in; `POST logout` cannot require a session, because it is disposing of one that may
 * already have expired.
 *
 * `GET me` is also `@TenantOptional()`, which is the other half of the same thought: it
 * needs a *person* and cannot need a *workspace*, because the workspaces are what it
 * answers with.
 */

import { Controller, Get, HttpStatus, Post, Res } from "@nestjs/common";

import { AppConfigService } from "../config/config.service";
import type { User } from "../db/schema";
import { AuthService } from "./auth.service";
import type { SessionResource } from "./auth.resources";
import { expireCookie } from "./cookies";
import { SET_COOKIE, type AuthResponse } from "./http";
import { TenantOptional } from "../tenancy/tenant.decorators";
import { CurrentUser } from "./principal";
import { Public } from "./public.decorator";
import { sessionCookieAttributes, SESSION_COOKIE } from "./session";

@Controller("auth")
export class AuthController {
  /**
   * @param auth - The rules: the session, and what a signed-in person is told about
   *   themselves.
   * @param config - For whether `Secure` goes on the cookie.
   */
  constructor(
    private readonly auth: AuthService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * `GET /api/v1/auth/me` — who is signed in, and where they belong.
   *
   * The first call `ouroboros-ui` makes on a page load, and the reason it is one call
   * rather than three: the shell needs the person, the workspaces they may switch between,
   * and — for somebody brand new — the tenant their email domain points at, before it can
   * render anything.
   *
   * `@TenantOptional()` ([#32](https://github.com/NobuData/ouroboros/issues/32)), and it is
   * the clearest case there is: this route's entire answer is the list of workspaces a
   * tenant would have had to be resolved *from*. Requiring one first would make somebody
   * with no memberships unable to discover that they have none.
   *
   * @param user - The signed-in person, established by the global guard.
   * @returns Them, their memberships, and the tenant suggestion when there are none.
   */
  @TenantOptional()
  @Get("me")
  read(@CurrentUser() user: User): Promise<SessionResource> {
    return this.auth.describe(user);
  }

  /**
   * `POST /api/v1/auth/logout` — sign out.
   *
   * `@Public()`, and idempotent: it clears the cookie and answers `204` whether or not
   * there was a session to clear. Requiring one would mean an *expired* cookie could never
   * be cleared — the request to remove it would be refused for carrying exactly the thing
   * it was trying to remove.
   *
   * A `POST` rather than a `GET`, because it changes state and because a `GET` that signs
   * you out is a link, an image tag or a prefetch away from signing you out.
   *
   * The session it clears is the browser's copy. A stateless token cannot be withdrawn
   * from anyone who already has it — see `session.ts`, and
   * [#38](https://github.com/NobuData/ouroboros/issues/38) for the revocable design.
   *
   * @param response - Where the cookie removal is written.
   */
  @Public()
  @Post("logout")
  logout(@Res() response: AuthResponse): void {
    response.setHeader(
      SET_COOKIE,
      expireCookie(SESSION_COOKIE, sessionCookieAttributes(this.config.isProduction)),
    );
    response.status(HttpStatus.NO_CONTENT).end();
  }
}
