/**
 * `/api/v1/auth` — sign in, find out who you are, sign out.
 *
 * The controller names routes and shapes and hands the rest to `AuthService`, exactly as
 * every tenancy controller does. What is different here, and worth stating, is that three
 * of the four routes are **not** the API's usual JSON-in, JSON-out shape:
 *
 *   * `GET github` and `GET github/callback` are pages a *browser* is navigated to, not
 *     calls a script makes. They answer `302`, and the cookie is the payload. A fetch from
 *     `ouroboros-ui` would be pointless — the browser has to visit github.com in its own
 *     address bar for a person to see the consent screen.
 *   * `POST logout` answers `204`. There is nothing to say; the `Set-Cookie` that removes
 *     the session is the whole of the answer.
 *
 * Three of the four are `@Public()`, and the fourth deliberately is not: `GET me` is the
 * route that answers *who is signed in*, so it is the one that must require being signed
 * in. Sign-in and sign-out cannot require a session — one has not got one yet and the
 * other is disposing of one that may already have expired.
 *
 * `GET me` is also `@TenantOptional()`, which is the other half of the same thought: it
 * needs a *person* and cannot need a *workspace*, because the workspaces are what it
 * answers with.
 */

import { Controller, Get, HttpStatus, Post, Query, Req, Res } from "@nestjs/common";

import { API_BASE_PATH } from "../../application";
import { AppConfigService } from "../config/config.service";
import type { User } from "../db/schema";
import { AuthService } from "./auth.service";
import type { SessionResource } from "./auth.resources";
import { GithubCallbackQuery } from "./auth.dto";
import { expireCookie, parseCookies, serializeCookie } from "./cookies";
import { SET_COOKIE, type AuthResponse } from "./http";
import { callbackUrl, handshakeCookieAttributes, HANDSHAKE_COOKIE } from "./oauth";
import { TenantOptional } from "../tenancy/tenant.decorators";
import { CurrentUser, type PrincipalRequest } from "./principal";
import { Public } from "./public.decorator";
import { sessionCookieAttributes, SESSION_COOKIE } from "./session";

/** The status every redirect here answers with. */
export const REDIRECT_STATUS = HttpStatus.FOUND;

@Controller("auth")
export class AuthController {
  /**
   * @param auth - The rules: the handshake, the identity upsert, the session.
   * @param config - For this service's own origin and the UI's, and for whether `Secure`
   *   goes on the cookies.
   */
  constructor(
    private readonly auth: AuthService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * `GET /api/v1/auth/github` — begin sign-in.
   *
   * Answers a redirect to github.com carrying the client id, the scopes, the anti-CSRF
   * state and the PKCE challenge, and sets the handshake cookie holding the state and the
   * verifier. It is a `GET` because a browser is navigated to it by a link on the sign-in
   * page; nothing is created until the callback.
   *
   * @param response - Where the cookie and the redirect are written.
   */
  @Public()
  @Get("github")
  start(@Res() response: AuthResponse): void {
    const started = this.auth.startSignIn(this.callbackUri());

    response.setHeader(
      SET_COOKIE,
      serializeCookie(
        HANDSHAKE_COOKIE,
        started.handshake,
        handshakeCookieAttributes(this.config.isProduction),
      ),
    );
    response.redirect(REDIRECT_STATUS, started.authorizeUrl);
  }

  /**
   * `GET /api/v1/auth/github/callback` — finish sign-in.
   *
   * Verifies the handshake, exchanges the code, resolves the person and lands the session
   * cookie, then sends the browser to `OURO_UI_URL`. The handshake cookie is cleared in
   * the same answer: it has served its purpose, and a used one left in the browser is a
   * value that outlives the trip it was for.
   *
   * @param query - GitHub's `code` and `state`, validated by the global pipe.
   * @param request - For the handshake cookie.
   * @param response - Where the cookies and the redirect are written.
   */
  @Public()
  @Get("github/callback")
  async callback(
    @Query() query: GithubCallbackQuery,
    @Req() request: PrincipalRequest,
    @Res() response: AuthResponse,
  ): Promise<void> {
    const session = await this.auth.completeSignIn(
      query.code,
      query.state,
      handshakeFrom(request),
      this.callbackUri(),
    );

    response.setHeader(SET_COOKIE, [
      serializeCookie(SESSION_COOKIE, session, sessionCookieAttributes(this.config.isProduction)),
      expireCookie(HANDSHAKE_COOKIE, handshakeCookieAttributes(this.config.isProduction)),
    ]);
    response.redirect(REDIRECT_STATUS, this.config.uiUrl);
  }

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

  /**
   * The absolute callback URL, built from configuration.
   *
   * Both routes need it and it must be *identical* in both: GitHub compares the
   * `redirect_uri` presented at the exchange with the one the authorize request carried,
   * and a difference of one character is a refused exchange.
   *
   * @returns The URL, from `OURO_REST_URL` and the API base path.
   */
  private callbackUri(): string {
    return callbackUrl(this.config.restUrl, API_BASE_PATH);
  }
}

/**
 * The handshake cookie's value out of a request.
 *
 * @param request - The request being handled.
 * @returns The value, or `undefined` when the browser sent none — which is what a callback
 *   somebody else composed looks like.
 */
function handshakeFrom(request: PrincipalRequest): string | undefined {
  return parseCookies(request.headers?.cookie).get(HANDSHAKE_COOKIE);
}
