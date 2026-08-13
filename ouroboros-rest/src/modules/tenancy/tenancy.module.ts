import { Module, RequestMethod, type MiddlewareConsumer, type NestModule } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";

import { DbModule } from "../db/db.module";
import { ConstraintViolationInterceptor } from "./constraints";
import { DomainsController } from "./domains.controller";
import { DomainsRepository } from "./domains.repository";
import { DomainsService } from "./domains.service";
import { EnablementRepository } from "./enablement.repository";
import { GithubOrgsController } from "./github-orgs.controller";
import { GithubOrgsService } from "./github-orgs.service";
import { OrganizationRepository } from "./organization.repository";
import { OrgsController } from "./orgs.controller";
import { OrgsService } from "./orgs.service";
import { ReposController } from "./repos.controller";
import { ReposService } from "./repos.service";
import { RolesGuard } from "./roles.guard";
import { TenantContextGuard } from "./tenant.guard";
import { TenantContextMiddleware } from "./tenant.middleware";
import { TenantResolver } from "./tenant.resolver";

/**
 * Tenancy — the workspaces a person belongs to, their domains, and the GitHub organisations
 * and repositories they have turned on.
 *
 * [#31](https://github.com/NobuData/ouroboros/issues/31) shipped this module against V001's
 * `tenants`/`tenant_members`; [#714](https://github.com/NobuData/ouroboros/issues/714) rewrote
 * it against the organization plugin's tables after
 * [#708](https://github.com/NobuData/ouroboros/issues/708) dropped the originals. Three layers
 * survive that rewrite unchanged, each with one job:
 *
 * ```
 * controller  route, request shape, nothing else   → orgs.controller.ts …
 * service     the rules, and the transactions      → orgs.service.ts …
 * repository  the statements, and nothing else     → organization.repository.ts …
 * ```
 *
 * **What this module is not, and the deletion is the point.** Creating a workspace, renaming
 * one, listing its members, inviting somebody, changing a role and revoking one are all served
 * by BetterAuth's organization plugin ([#704](https://github.com/NobuData/ouroboros/issues/704))
 * at `/api/auth/organization/*`. #714 deleted this module's versions — `TenantsController`,
 * `MembersController` and everything under them — rather than re-pointing them at the new
 * tables, because two write paths to `member` are two role checks that can drift apart. What
 * is left is what only this service has: the domains that resolve a workspace at sign-in, the
 * enablement flags that bound where an autonomous agent may operate, and the one read the
 * plugin cannot answer — `GET /api/v1/orgs`, a workspace *with* its counts and the caller's
 * role in it, which is mockup 01 Step 2's row model in a single request.
 *
 * **It imports `DbModule` rather than assuming it.** That import is the answer to "who can
 * reach the tenancy schema" — [#30](https://github.com/NobuData/ouroboros/issues/30) left
 * `DbModule` deliberately non-global so the question has one, and the repositories here are
 * where its `DatabaseService` is injected. Configuration needs no import: that module *is*
 * global, because every module reads configuration.
 *
 * **Four controllers, four services, three repositories.** The counts differ because the seams
 * are in different places at each layer: repositories are per *table group* —
 * `EnablementRepository` owns both GitHub tables, because a repository row is only reachable
 * through its organisation, and `OrganizationRepository` owns the library's two — while
 * controllers are per *path*, because `…/github-orgs/{login}/repos` and `…/github-orgs` take
 * different parameters and a class cannot have two shapes of them.
 *
 * **These routes are authenticated, and this module says nothing about it.** The session guard
 * [#703](https://github.com/NobuData/ouroboros/issues/703) registers is global — an
 * `APP_GUARD` provider in `BetterAuthModule` — so every controller here requires a session
 * without importing anything, and a controller added later is protected because somebody wrote
 * a controller. Authorization is the two guards below: `TenantContextGuard` resolves the
 * workspace and refuses a caller who is not a member (`404`, never `403` — see
 * `tenant.resolver.ts`), and `RolesGuard` refuses a member whose role is too low (`403`, the
 * one place this API answers it).
 */
@Module({
  imports: [DbModule],
  controllers: [OrgsController, DomainsController, GithubOrgsController, ReposController],
  providers: [
    ConstraintViolationInterceptor,
    TenantResolver,
    // Order matters, and it is the order of this list: the workspace has to be resolved
    // before a role in it can be checked, and Nest runs global guards in the order they are
    // registered. `tenancy.module.spec.ts` asserts the consequence rather than the order.
    { provide: APP_GUARD, useClass: TenantContextGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    // `organization` and `member` — the library's tables, read-only here, and what both the
    // tenant context and `GET /api/v1/orgs` are built on.
    OrganizationRepository,
    DomainsRepository,
    // `github_orgs` and `github_repos` — V003's enablement pair, re-parented by V006.
    EnablementRepository,
    OrgsService,
    DomainsService,
    GithubOrgsService,
    ReposService,
  ],
  // Nothing is exported. `TenantsService` and `MembersService` were, for a
  // [#32](https://github.com/NobuData/ouroboros/issues/32) that has since been answered by the
  // guards above and for a `/auth/me` #711 deleted — so both exports had no importer left, and
  // an export nothing imports is an invitation to reach past a controller into these rules.
})
export class TenancyModule implements NestModule {
  /**
   * Open a tenant context for every request.
   *
   * The middleware resolves nothing — see `tenant.middleware.ts` for why it cannot, and why
   * it has to be middleware anyway. It is applied to *every* route, public ones included: a
   * store nothing writes to costs one object, and it means `currentTenant()` is a question
   * with an honest answer everywhere rather than one that throws on the routes somebody
   * forgot to list.
   *
   * @param consumer - Nest's middleware builder.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenantContextMiddleware).forRoutes({ path: "*path", method: RequestMethod.ALL });
  }
}
