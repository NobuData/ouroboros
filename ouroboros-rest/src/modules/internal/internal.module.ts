import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";

import { AuditModule } from "../audit/audit.module";
import { DbModule } from "../db/db.module";
import { CredentialsController } from "./credentials.controller";
import { InternalKeyGuard } from "./internal.guard";
import { InternalRepository } from "./internal.repository";
import { LeaseAudit } from "./lease.audit";
import { LeaseService } from "./lease";
import { LlmController } from "./llm.controller";
import { LocalProviders } from "./local.providers";

/**
 * The engine-facing surface — the only part of this service a browser never reaches.
 *
 * AD.3 ([#224](https://github.com/NobuData/ouroboros/issues/224)), decision **P3**. Two
 * routes, and the asymmetry between them is the ticket:
 *
 * ```
 * POST /internal/credentials/lease   implemented here   — local providers, an address, audited
 * POST /internal/llm/invoke          specified here     — the proxy, implemented by AF.2 (#235)
 * ```
 *
 * ---------------------------------------------------------------------------
 * **This module inverts the direction the internal boundary has run in until now.** Since
 * [#51](https://github.com/NobuData/ouroboros/issues/51), `X-Ouro-Internal-Key` has meant
 * *this service calling the engine*: `EngineModule` holds the client that sends it, and
 * `ouroboros_engine.core.security` holds the middleware that checks it. Here the same header
 * and the same variable (`OURO_ENGINE_SHARED_SECRET`) travel the other way, so this module
 * is the mirror of that middleware — `InternalKeyGuard`, registered globally and gated on
 * `@InternalOnly()`.
 *
 * **The guard is global rather than `@UseGuards()` on the two controllers**, and that is a
 * decision about the failure mode rather than about style. A controller-scoped guard protects
 * the routes somebody remembered to decorate; forgetting produces an unauthenticated internal
 * endpoint, which is the worst thing this module could ship. Registered as an `APP_GUARD` it
 * protects whatever carries `@InternalOnly()`, and `internal.module.spec.ts` asserts the
 * other half — that every route whose *path* is under `/internal` carries the decorator — so
 * neither can be forgotten quietly.
 *
 * It is registered after `BetterAuthModule`'s session guard and `TenancyModule`'s tenant
 * guard, because Nest runs global guards in the order their modules are initialised and
 * `AppModule` lists this one last. That ordering is what lets these routes be
 * `@AllowAnonymous()` without being *public*: the session guard steps aside, the tenant guard
 * steps aside behind it, and this one refuses everything that cannot prove where it came
 * from.
 *
 * **It imports `DbModule`** for one statement — which workspace a run belongs to
 * (`internal.repository.ts`) — and that import is the answer to *who can reach the runs
 * table*, exactly as `TenancyModule`'s is for the tenancy schema. It imports nothing for
 * configuration, which is global.
 *
 * **It exports nothing.** Nothing in this service should call the lease surface: it exists
 * for a caller outside the process, and a second in-process consumer would be a sign that
 * the policy had grown a second implementation. AF.2 adds the executor *here*, beside the
 * route it answers, rather than importing this module from somewhere else.
 */
@Module({
  imports: [DbModule, AuditModule],
  controllers: [CredentialsController, LlmController],
  providers: [
    LocalProviders,
    InternalRepository,
    LeaseAudit,
    LeaseService,
    { provide: APP_GUARD, useClass: InternalKeyGuard },
  ],
})
export class InternalModule {}
