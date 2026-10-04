/**
 * Service accounts — non-human principals with scoped, hash-only tokens
 * ([#485](https://github.com/NobuData/ouroboros/issues/485), BR.1).
 *
 * ```
 * controller   the settings routes, administrators only    → service-accounts.controller.ts
 * service      create / rotate / revoke, sealing, audit    → service-accounts.service.ts
 * repository   the statements, and nothing else            → service-accounts.repository.ts
 * middleware   Bearer orb_svc_… → a principal on the request → service-token.middleware.ts
 * ```
 *
 * The rest of the principal's path lives where the guards are: `src/auth/session-or-service.guard.ts`
 * lets it past the session check, `tenancy/tenant.guard.ts` checks its scope
 * (`auth/service.scopes.ts`) and sets its workspace and audit actor.
 */

import { Module, RequestMethod, type MiddlewareConsumer, type NestModule } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";
import { DbModule } from "../db/db.module";
import { VaultModule } from "../vault/vault.module";
import { ServiceAccountsController } from "./service-accounts.controller";
import { ServiceAccountsRepository } from "./service-accounts.repository";
import { ServiceAccountsService } from "./service-accounts.service";
import { ServiceTokenMiddleware } from "./service-token.middleware";

@Module({
  imports: [DbModule, AuditModule, VaultModule],
  controllers: [ServiceAccountsController],
  providers: [ServiceAccountsRepository, ServiceAccountsService, ServiceTokenMiddleware],
})
export class ServiceAccountsModule implements NestModule {
  /**
   * Authenticate service tokens on every route, ahead of every guard.
   *
   * @param consumer - Nest's middleware registrar.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(ServiceTokenMiddleware).forRoutes({ path: "*path", method: RequestMethod.ALL });
  }
}
