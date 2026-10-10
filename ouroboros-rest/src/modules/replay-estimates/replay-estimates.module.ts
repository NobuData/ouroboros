/**
 * The infra replay estimators (CD.3, [#561](https://github.com/NobuData/ouroboros/issues/561)):
 * the service, its statements and the engine-facing route. The service is exported for dry-run
 * orchestration (CD.4, #562), which estimates from inside this process.
 */

import { Module } from "@nestjs/common";

import { DbModule } from "../db/db.module";
import { ReplayEstimateRepository } from "./replay.repository";
import { ReplayEstimateService } from "./replay.service";
import { ReplayEstimatesInternalController } from "./replay.internal.controller";

@Module({
  imports: [DbModule],
  controllers: [ReplayEstimatesInternalController],
  providers: [ReplayEstimateRepository, ReplayEstimateService],
  exports: [ReplayEstimateService],
})
export class ReplayEstimatesModule {}
