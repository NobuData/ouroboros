/**
 * What a signed-in person is told about themselves, and the eviction of the cookie that
 * used to sign them in ([#33](https://github.com/NobuData/ouroboros/issues/33),
 * [#703](https://github.com/NobuData/ouroboros/issues/703)).
 *
 * Three layers, the same as `TenancyModule`: a controller that names routes, a service that
 * holds the rules, a repository that holds the statements.
 *
 * **Sign-in is not one of them.** `GithubClient` — the boundary to GitHub, kept here as a
 * provider so a test could replace the whole of GitHub with an object — went with
 * `github.ts` in [#702](https://github.com/NobuData/ouroboros/issues/702), which moved the
 * flow to BetterAuth. That module is `src/auth/`, and it is mounted from `AppModule`
 * independently of this one: the library serves its own routes on the HTTP adapter rather
 * than through Nest's router, so there is nothing for this module to import or re-export.
 *
 * **And the guard is not one of them any anymore.** This module used to register
 * `SessionGuard` as an `APP_GUARD` — "run this before every handler in the application" —
 * which was what made every route authenticated by default. #703 replaced it with the
 * library's own `AuthGuard`, registered by `src/auth/auth.module.ts`, and the polarity is
 * unchanged: **every route is authenticated unless it says otherwise**, and the way it says
 * so is now `@AllowAnonymous()` rather than `@Public()`. What moved with the guard was
 * `auth.guard.ts`, `public.decorator.ts`, `session.ts`, `signing.ts` and `cookies.ts` —
 * deleted, not deprecated. `guard.surface.spec.ts` is what holds the exemption list to
 * exactly the surface #33 shipped.
 *
 * What this module contributes to every request instead is one piece of middleware, and it
 * is temporary: `LegacySessionCookieMiddleware` tells a browser still holding `ouro_session`
 * to drop it. See `legacy.cookie.ts`, which is also where the date it can be deleted is
 * written down.
 *
 * It imports `DbModule` and not `TenancyModule`. The session's answer reads `tenant_members`
 * and `tenants` as statements of its own rather than through tenancy's services — those
 * enforce the tenancy API's rules, which are about a caller administering a workspace, and
 * none of them apply to the question "where does this person belong".
 */

import { Module, RequestMethod, type MiddlewareConsumer, type NestModule } from "@nestjs/common";

import { BetterAuthModule } from "../../auth/auth.module";
import { DbModule } from "../db/db.module";
import { AuthController } from "./auth.controller";
import { AuthRepository } from "./auth.repository";
import { AuthService } from "./auth.service";
import { LegacySessionCookieMiddleware } from "./legacy.cookie";

@Module({
  // `BetterAuthModule` for the library's `AuthService`, which is how `POST /auth/logout`
  // reaches `auth.api.signOut`. The library's own module is global, so this import is not
  // what makes the provider resolvable — it is what makes "this module depends on
  // BetterAuth" a line somebody can read in the `imports` list rather than a surprise in a
  // constructor.
  imports: [BetterAuthModule, DbModule],
  controllers: [AuthController],
  providers: [AuthRepository, AuthService, LegacySessionCookieMiddleware],
  // `AuthService` is what [#32](https://github.com/NobuData/ouroboros/issues/32) resolves a
  // request's memberships through. Exported for that, and only that.
  exports: [AuthService],
})
export class AuthModule implements NestModule {
  /**
   * Evict `ouro_session` from every request that still carries one.
   *
   * Applied to every route rather than to the auth routes alone, because the cookie is
   * dead everywhere: a browser sending it to the heartbeat is holding the same stale value
   * as one sending it to the tenancy API, and a route-by-route list is a list somebody has
   * to keep complete.
   *
   * @param consumer - Nest's middleware builder.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(LegacySessionCookieMiddleware)
      .forRoutes({ path: "*path", method: RequestMethod.ALL });
  }
}
