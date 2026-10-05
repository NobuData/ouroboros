/**
 * Retention — one policy service, per-class tiers, consumed by every sweep (BQ.3,
 * [#482](https://github.com/NobuData/ouroboros/issues/482)).
 *
 * ```
 * retention.policy.ts      the classes, defaults, bounds and the one cutoff formula
 * retention.cutoffs.ts     a sweep's per-workspace cutoffs, and the SQL `case` over them
 * retention.service.ts     RetentionPolicyService — cutoffs(), retainUntil(), read(), update()
 * retention.schedule.ts    each class's next sweep and last tombstone count
 * retention.repository.ts  the statements over retention_policies (V094, V101)
 * retention.controller.ts  GET / PATCH /api/v1/settings/retention
 * ```
 *
 * It exports the service and the schedule to the sweeps that read them — the build-log sweep
 * (`FarmLogsModule`), the artifact sweep (`ResultsModule`), the transcript sweep (`RunsModule`)
 * and the audit purge (`AuditPlaneModule`, BR.2). It imports none of them, so the dependency only ever
 * points from a sweep to its policy.
 */

import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";
import { DbModule } from "../db/db.module";
import { RetentionController } from "./retention.controller";
import { RetentionRepository } from "./retention.repository";
import { RetentionSchedule } from "./retention.schedule";
import { RetentionPolicyService } from "./retention.service";

@Module({
  // `AuditModule` for the `workspace.retention_changed` event.
  imports: [DbModule, AuditModule],
  controllers: [RetentionController],
  providers: [RetentionPolicyService, RetentionRepository, RetentionSchedule],
  exports: [RetentionPolicyService, RetentionSchedule],
})
export class RetentionModule {}
