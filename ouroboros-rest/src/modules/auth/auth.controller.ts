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
 * **Signing out is the opposite case, and is kept.**
 * [#703](https://github.com/NobuData/ouroboros/issues/703) asked whether `POST logout`
 * should go the same way as the sign-in routes, and the answer is no, for the reason that
 * made sign-in impossible to forward: here there *is* an honest forward. BetterAuth's
 * `POST /api/auth/sign-out` is a `POST` that takes the session cookie and answers, which is
 * exactly what this route already is — so this handler delegates to it rather than
 * reimplementing it, and the API keeps a documented sign-out through the whole cut-over
 * instead of losing one until [#718](https://github.com/NobuData/ouroboros/issues/718)
 * re-points the UI. The issue's own instruction is what settles it: *port every `@Public()`
 * annotation one for one — the shipped public surface is the spec*, and deleting a route is
 * not porting its exemption.
 *
 * ---
 *
 * Of the two routes, one is `@AllowAnonymous()` and one deliberately is not. `GET me` is the
 * route that answers *who is signed in*, so it is the one that must require being signed
 * in; `POST logout` cannot require a session, because it is disposing of one that may
 * already have expired.
 *
 * `GET me` is also `@TenantOptional()`, which is the other half of the same thought: it
 * needs a *person* and cannot need a *workspace*, because the workspaces are what it
 * answers with.
 */

import { Controller, Get, HttpStatus, Post, Req, Res } from "@nestjs/common";
import { AllowAnonymous, AuthService as BetterAuth, Session } from "@thallesp/nestjs-better-auth";

import type { Auth } from "../../auth/auth.factory";
import { AuthService } from "./auth.service";
import type { SessionResource } from "./auth.resources";
import { appendSetCookie, cookieHeaders, type AuthRequest, type AuthResponse } from "./http";
import { TenantOptional } from "../tenancy/tenant.decorators";
import { principalUser, type Principal } from "./principal";

@Controller("auth")
export class AuthController {
  /**
   * @param auth - The rules: what a signed-in person is told about themselves.
   * @param betterAuth - The library's typed access to `auth.api`, from `src/auth/`. Sign-out
   *   is the library's operation — it deletes the `session` row — and this is how a Nest
   *   handler calls it without holding the instance itself.
   */
  constructor(
    private readonly auth: AuthService,
    private readonly betterAuth: BetterAuth<Auth>,
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
   * The person now comes from the session rather than from a row read per request — see
   * `principal.ts`, which is where that trade and the id that makes it safe are argued.
   *
   * @param principal - The session, established by the global guard. Typed nullable because
   *   the library's decorator is: a route that also carried `@AllowAnonymous()` would be
   *   handed `null`, and `principalUser` is what refuses that loudly rather than three
   *   layers down.
   * @returns Them, their memberships, and the tenant suggestion when there are none.
   */
  @TenantOptional()
  @Get("me")
  read(@Session() principal: Principal | null): Promise<SessionResource> {
    return this.auth.describe(principalUser(principal));
  }

  /**
   * `POST /api/v1/auth/logout` — sign out.
   *
   * `@AllowAnonymous()`, and idempotent: it answers `204` whether or not there was a session
   * to end. Requiring one would mean an *expired* cookie could never be cleared — the
   * request to remove it would be refused for carrying exactly the thing it was trying to
   * remove.
   *
   * A `POST` rather than a `GET`, because it changes state and because a `GET` that signs
   * you out is a link, an image tag or a prefetch away from signing you out.
   *
   * **What it ends is the session, not the browser's copy of it.** That is the change
   * [#703](https://github.com/NobuData/ouroboros/issues/703) makes and the property
   * [#38](https://github.com/NobuData/ouroboros/issues/38) asked for: `signOut` deletes the
   * `ouroboros.session` row, so a cookie copied beforehand stops working on its next use
   * rather than remaining good for the rest of its week. The cookie removals the library
   * writes — the session token and its cache — are copied onto this answer, which is what
   * makes the same call also clear the browser that asked.
   *
   * @param request - For the `Cookie` header, which is how the library is told which session
   *   to delete — see `cookieHeaders`.
   * @param response - Where the cookie removals are written. Appended rather than set, so
   *   the legacy `ouro_session` eviction `legacy.cookie.ts` already wrote on this request
   *   survives — see `appendSetCookie`.
   */
  @AllowAnonymous()
  @Post("logout")
  async logout(@Req() request: AuthRequest, @Res() response: AuthResponse): Promise<void> {
    const answer = await this.betterAuth.api.signOut({
      headers: cookieHeaders(request),
      asResponse: true,
    });

    // `getSetCookie()` rather than iterating the headers: `Headers.forEach` folds repeated
    // values into one comma-joined string, and `Set-Cookie` is the one header for which
    // that is not merely lossy but wrong — a browser reads the join as a single malformed
    // cookie and sets none of them.
    appendSetCookie(response, answer.headers.getSetCookie());

    response.status(HttpStatus.NO_CONTENT).end();
  }
}
