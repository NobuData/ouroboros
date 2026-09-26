/**
 * The run control queue — AP.4 ([#306](https://github.com/NobuData/ouroboros/issues/306)),
 * decision **R6**.
 *
 * The same three layers as everywhere, with two controllers because the queue has two callers:
 *
 * ```
 * controllers  /api/v1/runs/:id/controls (a person) → controls.controller.ts
 *              /internal/runs/:id/controls/… (an executor) → controls.internal.controller.ts
 * service      the policy, the four operations      → controls.service.ts
 * repository   the statements, and nothing else     → controls.repository.ts
 * ```
 *
 * plus `controls.policy.ts` (the pure rules) and `controls.sweeper.ts` (the TTL loop).
 *
 * A module of its own rather than more routes on `RunsModule` or `IngestModule`. The first is
 * a read surface and the second a report surface, and this is neither: a person writes and an
 * executor answers. Its internal controller is protected by `InternalModule`'s `APP_GUARD`,
 * wherever the module is registered, exactly as `IngestModule`'s is.
 *
 * `ScheduleModule.forRoot()` is imported for `SchedulerRegistry`, as `EstimationModule` does.
 * **It exports `ControlsService` and nothing below it.** The routes are one surface; the Mark &
 * Route card's correction round ([#332](https://github.com/NobuData/ouroboros/issues/332)) is the
 * other, and it goes through the service's own `correctionRound`, so the role policy, the
 * transcript entry and the audit trigger are the same ones a person pressing a button meets.
 * The repository stays private: a writer below the service would be a path around the policy.
 */

import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";

import { DbModule } from "../db/db.module";
import { ControlsController } from "./controls.controller";
import { ControlsInternalController } from "./controls.internal.controller";
import { ControlsRepository } from "./controls.repository";
import { ControlsService } from "./controls.service";
import { ControlsSweeper } from "./controls.sweeper";

@Module({
  imports: [DbModule, ScheduleModule.forRoot()],
  controllers: [ControlsController, ControlsInternalController],
  providers: [ControlsRepository, ControlsService, ControlsSweeper],
  exports: [ControlsService],
})
export class ControlsModule {}
