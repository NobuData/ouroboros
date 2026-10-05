/**
 * The audit plane — the readable half of the audit log, and its retention (BR.2,
 * [#486](https://github.com/NobuData/ouroboros/issues/486); delivers the surface #26 deferred).
 *
 * ```
 * filter      query string ─▶ structured filter, one place      → audit-plane.filter.ts
 * cursor      the keyset position, microsecond-exact            → audit-plane.cursor.ts
 * repository  one filtered keyset select, and its count         → audit-plane.repository.ts
 * sentences   time · actor · event, composed from typed facts   → audit-plane.sentences.ts
 * csv         the stable column contract                        → audit-plane.csv.ts
 * service     list · today · export (audited, streamed)         → audit-plane.service.ts
 * controller  /api/v1/settings/audit                            → audit-plane.controller.ts
 * purge       the `audit` tier's sweep, with tombstone counts   → audit-purge.sweeper.ts
 * ```
 *
 * **A module of its own rather than more of `audit/`.** `RetentionModule` imports `AuditModule`
 * (it audits tier changes), and the purge needs the retention tier — so the purge living in
 * `audit/` would be a cycle. `audit/` stays the trail's writer; this module reads, exports and
 * purges, writing only through `AuditService` like every other plane. The audit fan-out to the
 * webhook outbox (BR.3, #487) needs nothing here: every row, these two new actions included, is
 * published as `audit.<action>` in its own insert's transaction.
 */

import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";
import { DbModule } from "../db/db.module";
import { RetentionModule } from "../retention/retention.module";
import { AuditPlaneController } from "./audit-plane.controller";
import { AuditPlaneRepository } from "./audit-plane.repository";
import { AuditPlaneService } from "./audit-plane.service";
import { AuditPurgeRepository } from "./audit-purge.repository";
import { AuditPurgeSweeper } from "./audit-purge.sweeper";

@Module({
  imports: [DbModule, AuditModule, RetentionModule],
  controllers: [AuditPlaneController],
  providers: [AuditPlaneRepository, AuditPlaneService, AuditPurgeRepository, AuditPurgeSweeper],
  exports: [AuditPlaneService],
})
export class AuditPlaneModule {}
