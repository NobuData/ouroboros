/**
 * Build logs — ingest, retrieval and retention, as a module.
 *
 * AH.5 ([#253](https://github.com/NobuData/ouroboros/issues/253)) under epic
 * [#240](https://github.com/NobuData/ouroboros/issues/240), decision **B8**. The layers:
 *
 * ```
 * the route      logs.controller.ts    GET /farm/jobs/:id/log?after= (every member)
 * the read       logs.service.ts       live = the job's state · a page · the tail
 *                log.slice.ts          a page ends on a character boundary; markers by position
 * the ingest     log.ingest.ts         log.chunk / job.finish from the gateway's listeners
 *                reassembly.ts         seq order before anything is stored
 *                rate.guard.ts         per workspace; refusals are elided and marked
 * the rows       log.repository.ts     every statement; the cap trigger does the rest
 * retention      log.retention.ts      30 days per chunk · a byte budget per workspace · whole logs
 * log.policy.ts  every number, once
 * ```
 *
 * **It imports the gateway and the gateway does not import it** — dispatch's position (#252), for
 * dispatch's reason: frames arrive through `AgentSessions.listen`. It exports `FarmLogsService`
 * for the readers to come (mockup 10's run console; #510's analyzer when it grows tail reads) and
 * the {@link FARM_LOG_RETENTION} token for #482 to bind its retention service to.
 */

import { Module } from "@nestjs/common";

import { AppConfigService } from "../../config/config.service";
import { DbModule } from "../../db/db.module";
import { FarmGatewayModule } from "../gateway/gateway.module";
import { LogIngest } from "./log.ingest";
import { LOG_RETENTION_DAYS } from "./log.policy";
import { LogRepository } from "./log.repository";
import { FARM_LOG_RETENTION, LogRetentionSweeper, type LogRetentionPolicy } from "./log.retention";
import { FarmLogsController } from "./logs.controller";
import { FarmLogsService } from "./logs.service";
import { FARM_LOG_RATE_GUARD, RateGuard } from "./rate.guard";

@Module({
  imports: [DbModule, FarmGatewayModule],
  controllers: [FarmLogsController],
  providers: [
    LogRepository,
    LogIngest,
    LogRetentionSweeper,
    FarmLogsService,
    { provide: FARM_LOG_RATE_GUARD, useFactory: () => new RateGuard() },
    {
      // Thirty days and the configured budget, until BQ.3's retention service (#482) binds its own.
      provide: FARM_LOG_RETENTION,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): LogRetentionPolicy => ({
        days: LOG_RETENTION_DAYS,
        budgetBytesPerOrg: config.farmLogBudgetBytes,
      }),
    },
  ],
  exports: [FarmLogsService, FARM_LOG_RETENTION],
})
export class FarmLogsModule {}
