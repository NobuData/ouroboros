/**
 * Live-run admission (DI.4, [#1312](https://github.com/NobuData/ouroboros/issues/1312)) — the one
 * decision a queued item passes before the engine may claim it, and the reason a person reads
 * when it has not.
 *
 * **It exports `AdmissionService` and nothing below it.** The claim (`IngestModule`) decides
 * with it; the queue, the dashboard and the backlog explain with it — so a reason shown and the
 * claim that acted on it come from one evaluator. The confirmation route
 * (`POST /api/v1/queue/{id}/confirm`) lives here because it writes the one column admission
 * owns.
 */

import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";
import { DbModule } from "../db/db.module";
import { EngineModule } from "../engine/engine.module";
import { LifecycleStateModule } from "../lifecycle/lifecycle-state.module";
import { LoopModule } from "../loop/loop.module";
import { PoliciesModule } from "../policies/policies.module";
import { RoutingModule } from "../routing/routing.module";
import { CapabilityRepository } from "../tenancy/capability.repository";
import { AdmissionRepository } from "./admission.repository";
import { AdmissionService } from "./admission.service";
import { ConfirmController, LiveExecutionSettingsController } from "./confirm.controller";
import { ConfirmService } from "./confirm.service";

@Module({
  imports: [
    DbModule,
    AuditModule,
    EngineModule,
    LifecycleStateModule,
    LoopModule,
    PoliciesModule,
    RoutingModule,
  ],
  controllers: [ConfirmController, LiveExecutionSettingsController],
  // `CapabilityRepository` is the tenancy module's own read, provided again here rather than
  // exported from there: an enqueue asks the same question the capability guard does.
  providers: [AdmissionRepository, AdmissionService, ConfirmService, CapabilityRepository],
  exports: [AdmissionService],
})
export class AdmissionModule {}
