/**
 * `/api/v1/auth` — signing out, and nothing else.
 *
 * One route. It is not the API's usual JSON-in, JSON-out shape: it answers `204`, because
 * there is nothing to say and the `Set-Cookie` that removes the session is the whole of the
 * answer.
 *
 * ---
 *
 * **`GET me` is not here any more, and nothing replaced it under `/api/v1`.**
 * [#711](https://github.com/NobuData/ouroboros/issues/711) deleted it while publishing the
 * auth surface, because two routes answering *who is signed in* are two answers that can
 * disagree — and this one answered from `tenant_members` and `tenants`, which
 * `V006__tenancy_extensions.sql` had already dropped
 * ([#708](https://github.com/NobuData/ouroboros/issues/708)). It was a route that could
 * only have answered `500`.
 *
 * The question it asked is now three calls against BetterAuth's own surface, and a client
 * makes them through BetterAuth's client rather than through the generated one:
 *
 *   * `GET /api/auth/get-session` — the person.
 *   * `GET /api/auth/organization/list` — the workspaces they belong to.
 *   * `GET /api/auth/organization/get-active-member-role` — what they hold in one.
 *
 * `openapi.yaml` publishes all three and states the rule; `src/auth/auth.routes.ts` is the
 * map. **Do not add a fourth here.** The tenant suggestion the old route also carried —
 * *your organisation is already on Ouroboros* — is
 * [#712](https://github.com/NobuData/ouroboros/issues/712)'s `POST /api/v1/auth/discover`,
 * which is genuinely this service's because it reads this service's tenant domains.
 *
 * `AuthService` and `AuthRepository` went with the route: they existed to answer it, and
 * what is left of this module is a forward to the library plus one piece of middleware.
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
 * ---
 *
 * **`POST discover` is the second route, and it is the one this controller genuinely
 * owns.** [#712](https://github.com/NobuData/ouroboros/issues/712) is the endpoint the
 * paragraph above promised: mockup 01 Step 1's *Company domain* field, answered from this
 * service's `tenant_domains` rather than forwarded anywhere. It is here rather than under
 * `tenancy/` for the reason the note gives — it belongs to signing in, it is called before
 * anybody has a session, and the tenancy API is entirely behind one. `discovery.service.ts`
 * is where its two anti-enumeration properties are argued and `discovery.timing.ts` is
 * where the second of them is implemented.
 *
 * ---
 *
 * Both routes are `@AllowAnonymous()`, and both have to be. `POST logout` cannot require a
 * session, because it is disposing of one that may already have expired; `POST discover` is
 * called by a browser that has never had one, which is the whole of why its answer is
 * written the way it is.
 */

import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res } from "@nestjs/common";
import { AllowAnonymous, AuthService as BetterAuth } from "@thallesp/nestjs-better-auth";

import type { Auth } from "../../auth/auth.factory";
import { DiscoverBody } from "./discovery.dto";
import { DiscoveryService, type DiscoveryResource } from "./discovery.service";
import { appendSetCookie, cookieHeaders, type AuthRequest, type AuthResponse } from "./http";

@Controller("auth")
export class AuthController {
  /**
   * @param betterAuth - The library's typed access to `auth.api`, from `src/auth/`. Sign-out
   *   is the library's operation — it deletes the `session` row — and this is how a Nest
   *   handler calls it without holding the instance itself.
   * @param discovery - The domain lookup behind `POST discover`. A service rather than a
   *   repository, because what the endpoint has to get right is the rules — the uniform
   *   answer and the timing floor — and none of those belong in a route handler.
   */
  constructor(
    private readonly betterAuth: BetterAuth<Auth>,
    private readonly discovery: DiscoveryService,
  ) {}

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

  /**
   * `POST /api/v1/auth/discover` — is there a workspace at this company domain, and does it
   * use SSO?
   *
   * `@AllowAnonymous()`, and that is the fact the rest of the design follows from: it is
   * called from the sign-in card before anybody has a session, so every property that keeps
   * it from being a tenant-enumeration oracle has to hold for a stranger. Those properties
   * are `discovery.service.ts`'s, not this handler's — what is decided here is only that the
   * route exists, that it is exempt, and that it answers `200`.
   *
   * A `POST` rather than a `GET`, for two reasons that point the same way. A domain is an
   * organisation's name for itself, and a `GET` puts it in the request line — which is where
   * a proxy log, a browser history and a `Referer` all keep it. And a `GET` is cacheable by
   * anything in between, which for an answer that is about to become conditional on the
   * caller's domain (#722) is a shared cache holding one company's redirect for another.
   *
   * `200` rather than Nest's default `201` for a `POST`: nothing is created. This is a
   * question, and the verb is protecting the argument rather than describing it.
   *
   * @param body - The validated request. `discovery.dto.ts` has already normalised `domain`
   *   — lower-cased, trimmed, scheme and path stripped — so what arrives here is what the
   *   column would hold.
   * @returns The answer, which in this release is the same for every domain. Never sooner
   *   than the floor in `discovery.timing.ts`.
   */
  @AllowAnonymous()
  @HttpCode(HttpStatus.OK)
  @Post("discover")
  discover(@Body() body: DiscoverBody): Promise<DiscoveryResource> {
    return this.discovery.discover(body);
  }
}
