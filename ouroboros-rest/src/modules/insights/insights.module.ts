/**
 * `InsightsModule` — mockup 15's metrics domain, starting with estimator calibration (BI.4,
 * [#435](https://github.com/NobuData/ouroboros/issues/435)): the fill that grades every merged loop
 * against the estimate in force when it was queued, and `GET /api/v1/insights/calibration`.
 *
 * Exports `CALIBRATION_MERGE_OBSERVER`, bound to {@link CalibrationService}: `PullRequestsModule`
 * imports this module so its sync can report each merge it is the first to see.
 */

import { Module } from "@nestjs/common";

import { DbModule } from "../db/db.module";
import { CalibrationController } from "./calibration.controller";
import { CALIBRATION_MERGE_OBSERVER } from "./calibration.observer";
import { CalibrationRepository } from "./calibration.repository";
import { CalibrationService } from "./calibration.service";

@Module({
  imports: [DbModule],
  controllers: [CalibrationController],
  providers: [
    CalibrationRepository,
    CalibrationService,
    { provide: CALIBRATION_MERGE_OBSERVER, useExisting: CalibrationService },
  ],
  exports: [CALIBRATION_MERGE_OBSERVER],
})
export class InsightsModule {}
