/**
 * The audit trail — every credential operation's record, and the surface that pages it.
 *
 * AD.4 ([#225](https://github.com/NobuData/ouroboros/issues/225)), roadmap decision **P5**.
 *
 * ```
 * middleware  the request's address, into an AsyncLocalStorage store  → audit.middleware.ts
 * events      the vocabulary, and what a payload may hold             → audit.events.ts
 * service     the one writer, and the one reader                      → audit.service.ts
 * repository  an insert and a paged select. There is no third         → audit.repository.ts
 * controller  GET /api/v1/providers/audit                             → audit.controller.ts
 * ```
 *
 * **{@link AuditService} is exported, and it is the module's whole outward surface.** Two
 * other modules write through it — `provider-connections/` for the credential lifecycle and
 * `internal/` for AD.3's lease grants — and neither reaches the repository, which is what
 * keeps *the address comes from the request rather than from the caller* true of every event
 * rather than of the ones whose author remembered.
 *
 * **The middleware is applied to every route**, including the public ones, on
 * `tenancy.module.ts`'s reasoning: a store nothing reads costs one object per request, and
 * means the address is always a legitimate question with an honest answer rather than one
 * that returns nothing on the routes somebody forgot to list.
 *
 * **It imports `DbModule` rather than assuming it** — [#30](https://github.com/NobuData/ouroboros/issues/30)
 * left that module deliberately non-global so *who can reach the tenancy schema* has an
 * answer, and the repository here is where its `DatabaseService` is injected.
 */

import { Module, RequestMethod, type MiddlewareConsumer, type NestModule } from "@nestjs/common";

import { DbModule } from "../db/db.module";
import { AuditContextMiddleware } from "./audit.middleware";
import { AuditController } from "./audit.controller";
import { AuditRepository } from "./audit.repository";
import { AuditService } from "./audit.service";

@Module({
  imports: [DbModule],
  controllers: [AuditController],
  providers: [AuditRepository, AuditService],
  exports: [AuditService],
})
export class AuditModule implements NestModule {
  /**
   * Open an audit context for every request.
   *
   * @param consumer - Nest's middleware registrar.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(AuditContextMiddleware).forRoutes({ path: "*path", method: RequestMethod.ALL });
  }
}
