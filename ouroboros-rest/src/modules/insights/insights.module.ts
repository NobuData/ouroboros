/**
 * `InsightsModule` — mockup 15's metrics domain, starting with estimator calibration (BI.4,
 * [#435](https://github.com/NobuData/ouroboros/issues/435)): the fill that grades every merged loop
 * against the estimate in force when it was queued, and `GET /api/v1/insights/calibration`.
 *
 * Exports `CALIBRATION_MERGE_OBSERVER`, bound to {@link CalibrationService}: `PullRequestsModule`
 * imports this module so its sync can report each merge it is the first to see.
 *
 * BI.2 ([#433](https://github.com/NobuData/ouroboros/issues/433)) adds the rollup jobs: one
 * extractor per metric family (`rollup/extractors/`), filling `metric_daily` hourly for today, with
 * a nightly consolidation and a bounded, cursor-tracked backfill ({@link RollupScheduler}).
 *
 * BI.3 ([#434](https://github.com/NobuData/ouroboros/issues/434)) adds the intervention-cause
 * taxonomy's one service-side write: `POST /api/v1/insights/interventions/{id}/recategorize`, member
 * and above, audited. The events and their rule causes are the database's (V079's hooks).
 */

import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";

import { DbModule } from "../db/db.module";
import { CalibrationController } from "./calibration.controller";
import { CALIBRATION_MERGE_OBSERVER } from "./calibration.observer";
import { CalibrationRepository } from "./calibration.repository";
import { CalibrationService } from "./calibration.service";
import { InterventionsController } from "./interventions.controller";
import { InterventionRepository } from "./interventions.repository";
import { InterventionsService } from "./interventions.service";
import { ROLLUP_EXTRACTORS } from "./rollup/rollup.extractors";
import { RollupRepository } from "./rollup/rollup.repository";
import { RollupScheduler } from "./rollup/rollup.scheduler";
import { ROLLUP_FAMILIES, RollupService } from "./rollup/rollup.service";

@Module({
  imports: [DbModule, ScheduleModule.forRoot()],
  controllers: [CalibrationController, InterventionsController],
  providers: [
    CalibrationRepository,
    CalibrationService,
    { provide: CALIBRATION_MERGE_OBSERVER, useExisting: CalibrationService },
    { provide: ROLLUP_FAMILIES, useValue: ROLLUP_EXTRACTORS },
    RollupRepository,
    RollupService,
    RollupScheduler,
    InterventionRepository,
    InterventionsService,
  ],
  exports: [CALIBRATION_MERGE_OBSERVER],
})
export class InsightsModule {}
