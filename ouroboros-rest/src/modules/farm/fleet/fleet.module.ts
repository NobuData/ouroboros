/**
 * The build farm's read surfaces and lifecycle actions, as a module.
 *
 * AH.6 ([#254](https://github.com/NobuData/ouroboros/issues/254)) under epic
 * [#240](https://github.com/NobuData/ouroboros/issues/240). The layers, with the files that
 * carry the issue's criteria named beside them:
 *
 * ```
 * the routes   fleet.controller.ts    GET /farm — the whole page (every member)
 *              runners.controller.ts  drain · undrain · remove          (admin+)
 *              pools.controller.ts    pool CRUD + the enabled switch    (admin+)
 * the surface  fleet.service.ts       one observation, four statements
 *              runners.service.ts     the ⋯ menu, and the removal guard
 *              pools.service.ts       CRUD, and B9's inert preference
 * the rules    fleet.stats.ts         where null stops being zero
 *              fleet.policy.ts        the day boundary, the prior week, B5's label
 * the rows     fleet.repository.ts    filtered aggregates; no coalesce(avg(…), 0)
 *              fleet.resources.ts     row → resource; null is the mockup's em-dash
 *              fleet.dto.ts           V040's CHECKs, restated as 422s
 * ```
 *
 * The enroll command is **not** here. It mints a token, minting is `EnrollmentService`'s, and
 * that service is deliberately unexported — so the route sits on `enrollment.controller.ts`
 * beside `mint`, where `farm.module.ts` argues the placement.
 *
 * ---------------------------------------------------------------------------
 * **It imports three farm modules and adds nothing to them.**
 *
 *   * `FarmModule` — `RegistrationService`, for the certificate a removal revokes. Exported
 *     for this ticket; that module's header is where the export is argued.
 *   * `FarmGatewayModule` — `RunnerControl`, which AH.3
 *     ([#251](https://github.com/NobuData/ouroboros/issues/251)) built for this ticket's
 *     drain, and `GATEWAY_CLOCK`, which the stat row's *2h* has to share with the heartbeat
 *     that wrote `last_seen_at`.
 *   * `AuditModule` — AD.4's one writer, through this module's own `FarmAudit`.
 *
 * **It exports nothing.** Its routes are its surface, and there is no second caller: the UI
 * tickets it feeds (AI.1–AI.5) are clients over HTTP, not modules.
 */

import { Module } from "@nestjs/common";

import { AuditModule } from "../../audit/audit.module";
import { DbModule } from "../../db/db.module";
import { FarmAudit } from "../farm.audit";
import { FarmModule } from "../farm.module";
import { FarmGatewayModule } from "../gateway/gateway.module";
import { FleetController } from "./fleet.controller";
import { FleetRepository } from "./fleet.repository";
import { FleetService } from "./fleet.service";
import { FarmPoolsController } from "./pools.controller";
import { PoolsService } from "./pools.service";
import { FarmRunnersController } from "./runners.controller";
import { RunnersService } from "./runners.service";

@Module({
  imports: [DbModule, AuditModule, FarmModule, FarmGatewayModule],
  controllers: [FleetController, FarmRunnersController, FarmPoolsController],
  providers: [FleetRepository, FleetService, RunnersService, PoolsService, FarmAudit],
})
export class FarmFleetModule {}
