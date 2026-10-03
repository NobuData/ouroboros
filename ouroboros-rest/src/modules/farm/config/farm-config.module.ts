/**
 * `FarmConfigModule` — the farm configuration the Build Analyzer composes (BV.5,
 * [#514](https://github.com/NobuData/ouroboros/issues/514), decision A4): time-windowed pool
 * assignment and job hooks, each with its own routes, audit events and service.
 *
 * ```
 * the routes   farm-config.controller.ts   pool-windows · job-hooks   (reads: members; writes: admin+)
 * the writers  pool-windows.service.ts     runner_pool_windows (V040), idempotent
 *              job-hooks.service.ts        farm_job_hooks (V088), idempotent; fires on merge
 * the rows     farm-config.repository.ts
 * ```
 *
 * **It exports its two services and the merge observer.** The services are the Build Analyzer's
 * way into the farm — it may not write these tables (`analyzer/actions/boundary.spec.ts`) — and
 * `FARM_MERGE_OBSERVER` is how the PR sync reports a merge without importing the farm.
 */

import { Module } from "@nestjs/common";

import { AuditModule } from "../../audit/audit.module";
import { DbModule } from "../../db/db.module";
import { FarmDispatchModule } from "../dispatch/dispatch.module";
import { FarmAudit } from "../farm.audit";
import { FarmConfigController } from "./farm-config.controller";
import { FarmConfigRepository } from "./farm-config.repository";
import { JobHooksService } from "./job-hooks.service";
import { FARM_MERGE_OBSERVER } from "./merge.observer";
import { PoolWindowsService } from "./pool-windows.service";

@Module({
  imports: [DbModule, AuditModule, FarmDispatchModule],
  controllers: [FarmConfigController],
  providers: [
    FarmConfigRepository,
    FarmAudit,
    PoolWindowsService,
    JobHooksService,
    { provide: FARM_MERGE_OBSERVER, useExisting: JobHooksService },
  ],
  exports: [PoolWindowsService, JobHooksService, FARM_MERGE_OBSERVER],
})
export class FarmConfigModule {}
