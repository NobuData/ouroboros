/**
 * The session, and the guard that makes every other route in the service require one
 * ([#33](https://github.com/NobuData/ouroboros/issues/33)).
 *
 * Three layers, the same as `TenancyModule`: a controller that names routes, a service
 * that holds the rules, a repository that holds the statements.
 *
 * **Sign-in is no longer one of them.** `GithubClient` — the boundary to GitHub, kept here
 * as a provider so a test could replace the whole of GitHub with an object — went with
 * `github.ts` in [#702](https://github.com/NobuData/ouroboros/issues/702), which moved the
 * flow to BetterAuth. That module is `src/auth/`, and it is mounted from `AppModule`
 * independently of this one: the library serves its own routes on the HTTP adapter rather
 * than through Nest's router, so there is nothing for this module to import or re-export.
 *
 * **The guard is registered here, and globally.** `APP_GUARD` is Nest's token for "run
 * this before every handler in the application", and putting it in this module rather than
 * in `AppModule` is deliberate: the guard needs `AuthService`, which needs the repository
 * and configuration, and a provider declared where its dependencies are not is a module
 * graph that resolves by luck. What it means in practice is the polarity
 * `public.decorator.ts` argues for — **every route is authenticated unless it says
 * otherwise** — and it applies to `TenancyModule`'s routes without `TenancyModule` knowing
 * this module exists. [#703](https://github.com/NobuData/ouroboros/issues/703) is what
 * replaces it with the library's own.
 *
 * It imports `DbModule` and not `TenancyModule`. The session's answer reads `users`,
 * `tenant_members` and `tenants` as statements of its own rather than through tenancy's
 * services — those enforce the tenancy API's rules, which are about a caller administering
 * a workspace, and none of them apply to the question "who is this person". The overlap is
 * one select by address, and `auth.repository.ts` says why keeping two of it is cheaper
 * than the coupling that would remove one.
 */

import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";

import { DbModule } from "../db/db.module";
import { AuthController } from "./auth.controller";
import { SessionGuard } from "./auth.guard";
import { AuthRepository } from "./auth.repository";
import { AuthService } from "./auth.service";

@Module({
  imports: [DbModule],
  controllers: [AuthController],
  providers: [AuthRepository, AuthService, { provide: APP_GUARD, useClass: SessionGuard }],
  // `AuthService` is what [#32](https://github.com/NobuData/ouroboros/issues/32) resolves a
  // request's memberships through, and the guard is what its tenant middleware runs after.
  // Exported for that, and only that.
  exports: [AuthService],
})
export class AuthModule {}
