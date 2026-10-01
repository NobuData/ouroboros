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
 *
 * BJ.1 ([#437](https://github.com/NobuData/ouroboros/issues/437)) adds {@link MetricsService}: every
 * metric over a 7/30/90-day window, with its prior window, daily series and methodology. It is
 * exported so the dashboard's pulse card reads the same numbers as the Insights page.
 *
 * BJ.3 ([#439](https://github.com/NobuData/ouroboros/issues/439)) adds {@link ScoreboardService}:
 * mockup 15's model scoreboard — task kind × serving model, untouched %, $/success, trend, role and
 * sample — exported for the Insights read APIs (#438). AB.3 (#209) binds `SCOREBOARD_SUGGESTIONS`
 * when it exists; nothing here does.
 *
 * BJ.2 ([#438](https://github.com/NobuData/ouroboros/issues/438)) adds the page itself:
 * `GET /api/v1/insights?range=` (`page/`), one payload composed from the services above, the
 * flakes plane's card read (`FlakesModule`) and the workspace's provider caps. {@link
 * InsightsPageService} is exported so the email digest (#440) is assembled from the same payload
 * and inherits its honesty rules rather than re-deriving a number.
 */

import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";

import { DbModule } from "../db/db.module";
import { FlakesModule } from "../flakes/flakes.module";
import { CalibrationController } from "./calibration.controller";
import { CALIBRATION_MERGE_OBSERVER } from "./calibration.observer";
import { CalibrationRepository } from "./calibration.repository";
import { CalibrationService } from "./calibration.service";
import { InterventionsController } from "./interventions.controller";
import { InterventionRepository } from "./interventions.repository";
import { InterventionsService } from "./interventions.service";
import { MetricsCache } from "./metrics/metrics.cache";
import { MetricsRepository } from "./metrics/metrics.repository";
import { METRICS_CLOCK, MetricsService } from "./metrics/metrics.service";
import { InsightsPageController } from "./page/page.controller";
import { InsightsPageRepository } from "./page/page.repository";
import { InsightsPageService } from "./page/page.service";
import { ROLLUP_EXTRACTORS } from "./rollup/rollup.extractors";
import { RollupRepository } from "./rollup/rollup.repository";
import { RollupScheduler } from "./rollup/rollup.scheduler";
import { ROLLUP_FAMILIES, RollupService } from "./rollup/rollup.service";
import { ScoreboardRepository } from "./scoreboard/scoreboard.repository";
import { ScoreboardService } from "./scoreboard/scoreboard.service";

@Module({
  imports: [DbModule, FlakesModule, ScheduleModule.forRoot()],
  controllers: [CalibrationController, InterventionsController, InsightsPageController],
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
    MetricsRepository,
    MetricsCache,
    // The wall clock, bound by name so a suite can hold the page to one instant (#438).
    { provide: METRICS_CLOCK, useValue: Date.now },
    MetricsService,
    ScoreboardRepository,
    ScoreboardService,
    InsightsPageRepository,
    InsightsPageService,
  ],
  exports: [CALIBRATION_MERGE_OBSERVER, MetricsService, ScoreboardService, InsightsPageService],
})
export class InsightsModule {}
