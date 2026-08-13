/**
 * Signing out, and the eviction of the cookie that used to sign somebody in
 * ([#33](https://github.com/NobuData/ouroboros/issues/33),
 * [#703](https://github.com/NobuData/ouroboros/issues/703)).
 *
 * One layer. It had three — a controller, a service, a repository, the same shape as
 * `TenancyModule` — and the service and the repository existed to answer
 * `GET /api/v1/auth/me`, which
 * [#711](https://github.com/NobuData/ouroboros/issues/711) deleted along with them. Who is
 * signed in is BetterAuth's question now, answered on BetterAuth's own routes; see
 * `auth.controller.ts`, which names the three that replace it.
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
 * **`DbModule` is back, and it is one table this time.** #711 removed the import along with
 * the two statements that answered the session — a membership listing and a domain lookup,
 * both against `tenant_members` and `tenants`, which `V006__tenancy_extensions.sql` dropped
 * ([#708](https://github.com/NobuData/ouroboros/issues/708)).
 * [#712](https://github.com/NobuData/ouroboros/issues/712) puts it back for `POST
 * /api/v1/auth/discover`, whose whole job is a read of `tenant_domains` — the one tenancy
 * table V006 kept, and the one it re-pointed rather than deleted. The import is what answers
 * "who can reach the schema" for this module, exactly as it does for `TenancyModule`:
 * `DbModule` is deliberately not global, so the question always has a written answer.
 */

import { Module, RequestMethod, type MiddlewareConsumer, type NestModule } from "@nestjs/common";

import { BetterAuthModule } from "../../auth/auth.module";
import { DbModule } from "../db/db.module";
import { AuthController } from "./auth.controller";
import { DiscoveryRepository } from "./discovery.repository";
import { DiscoveryService } from "./discovery.service";
import { LegacySessionCookieMiddleware } from "./legacy.cookie";

@Module({
  // `BetterAuthModule` for the library's `AuthService`, which is how `POST /auth/logout`
  // reaches `auth.api.signOut`. The library's own module is global, so this import is not
  // what makes the provider resolvable — it is what makes "this module depends on
  // BetterAuth" a line somebody can read in the `imports` list rather than a surprise in a
  // constructor.
  imports: [BetterAuthModule, DbModule],
  controllers: [AuthController],
  // Two layers rather than three, and the missing one is deliberate: there is no
  // `DiscoveryController`. Discovery is a route on the auth controller because it is part of
  // signing in, and a controller per operation would put two `/api/v1/auth` paths in two
  // files with nothing to tell a reader which holds which.
  providers: [LegacySessionCookieMiddleware, DiscoveryRepository, DiscoveryService],
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
