/**
 * `FlakesModule` — the flake scorer & quarantine service (AT.3,
 * [#331](https://github.com/NobuData/ouroboros/issues/331), option **4-A**).
 *
 * ```
 * scorer       parse-time scoring and the nightly pass      → flake-scorer.service.ts
 * scheduler    when the nightly pass runs                   → flake-rescore.scheduler.ts
 * state        one case's state, the workspace summary      → flake-state.service.ts
 * controller   /api/v1/flakes/{summary,cases/:caseKey}      → flakes.controller.ts
 * repository   the statements; the formula is V054's        → flakes.repository.ts
 * ```
 *
 * It exports {@link FlakeScorerService} for `TestResultsModule`, whose parse writes each case's
 * occurrence and then asks the scorer to score what the attempt touched, and
 * {@link FlakeStateService} for `InsightsModule`, whose page reads the flaky card from it (#438).
 * `ScheduleModule.forRoot()` is imported for `SchedulerRegistry`, as `ControlsModule` does.
 */

import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";

import { DbModule } from "../db/db.module";
import { FlakeRescoreScheduler } from "./flake-rescore.scheduler";
import { FlakeScorerService } from "./flake-scorer.service";
import { FlakeStateService } from "./flake-state.service";
import { FlakesController } from "./flakes.controller";
import { FlakesRepository } from "./flakes.repository";

@Module({
  imports: [DbModule, ScheduleModule.forRoot()],
  controllers: [FlakesController],
  providers: [FlakesRepository, FlakeScorerService, FlakeStateService, FlakeRescoreScheduler],
  exports: [FlakeScorerService, FlakeStateService],
})
export class FlakesModule {}
