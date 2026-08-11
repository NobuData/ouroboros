import { Module, RequestMethod, type MiddlewareConsumer, type NestModule } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";

import { DbModule } from "../db/db.module";
import { ConstraintViolationInterceptor } from "./constraints";
import { DomainsController } from "./domains.controller";
import { DomainsRepository } from "./domains.repository";
import { DomainsService } from "./domains.service";
import { MembersController } from "./members.controller";
import { MembersRepository } from "./members.repository";
import { MembersService } from "./members.service";
import { OrgsController } from "./orgs.controller";
import { RolesGuard } from "./roles.guard";
import { TenantContextGuard } from "./tenant.guard";
import { TenantContextMiddleware } from "./tenant.middleware";
import { TenantResolver } from "./tenant.resolver";
import { OrgsRepository } from "./orgs.repository";
import { OrgsService } from "./orgs.service";
import { ReposController } from "./repos.controller";
import { ReposService } from "./repos.service";
import { TenantsController } from "./tenants.controller";
import { TenantsRepository } from "./tenants.repository";
import { TenantsService } from "./tenants.service";

/**
 * Tenancy — tenants, their domains, their members, and the GitHub organisations and
 * repositories they have turned on ([#31](https://github.com/NobuData/ouroboros/issues/31)).
 *
 * The first feature module in this service, and the shape the ones after it follow. Three
 * layers, each with one job:
 *
 * ```
 * controller  route, request shape, nothing else   → tenants.controller.ts …
 * service     the rules, and the transactions      → tenants.service.ts …
 * repository  the statements, and nothing else     → tenants.repository.ts …
 * ```
 *
 * **It imports `DbModule` rather than assuming it.** That import is the answer to "who can
 * reach the tenancy schema" — [#30](https://github.com/NobuData/ouroboros/issues/30) left
 * `DbModule` deliberately non-global so the question has one, and the repositories here are
 * where its `DatabaseService` is injected. Configuration needs no import: that module *is*
 * global, because every module reads configuration.
 *
 * **Five controllers, four services, three repositories.** The counts differ because the
 * seams are in different places at each layer: repositories are per *table group* —
 * `OrgsRepository` owns both GitHub tables, because a repository row is only reachable
 * through its organisation — while controllers are per *path*, because
 * `…/orgs/{login}/repos` and `…/orgs` take different parameters and a class cannot have two
 * shapes of them.
 *
 * **These routes are authenticated, and this module says nothing about it.** The session
 * guard [#33](https://github.com/NobuData/ouroboros/issues/33) registers is global — an
 * `APP_GUARD` provider in `AuthModule` — so every controller here requires a session
 * without importing anything, and a controller added later is protected because somebody
 * wrote a controller. What is not enforced yet is *authorization*: the role a mutation
 * needs, and the `404`-not-`403` rule for a tenant the caller cannot see, both of which are
 * [#32](https://github.com/NobuData/ouroboros/issues/32)'s `RolesGuard` and tenant context.
 * Everything that does not need to know who is asking is enforced today: the shapes, the
 * last-owner rule, and every constraint the migrations declare.
 */
@Module({
  imports: [DbModule],
  controllers: [
    TenantsController,
    DomainsController,
    MembersController,
    OrgsController,
    ReposController,
  ],
  providers: [
    ConstraintViolationInterceptor,
    TenantResolver,
    // Order matters, and it is the order of this list: the tenant has to be resolved before
    // a role in it can be checked, and Nest runs global guards in the order they are
    // registered. `tenancy.module.spec.ts` asserts the consequence rather than the order.
    { provide: APP_GUARD, useClass: TenantContextGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    TenantsRepository,
    DomainsRepository,
    MembersRepository,
    OrgsRepository,
    TenantsService,
    DomainsService,
    MembersService,
    OrgsService,
    ReposService,
  ],
  // `TenantsService` is what [#32](https://github.com/NobuData/ouroboros/issues/32) will
  // resolve a request's tenant through, and #33 what it will read memberships from. Exported
  // for that, and only that: nothing else in this service should be reaching past a
  // controller into these rules.
  exports: [TenantsService, MembersService],
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
