/**
 * `InvestigationLifecycleModule` — the public lifecycle of an investigation (CM.6,
 * [#625](https://github.com/NobuData/ouroboros/issues/625)): start, cancel, list, detail, the
 * progress stream, and the workspace's starter-role setting.
 *
 * It composes what the earlier research tickets export and builds nothing of theirs: the
 * estimate check is {@link ResearchModule}'s `ResearchEstimateService` (CM.3, #622), and
 * dispatch and cancel are {@link InvestigationLoopModule}'s `InvestigationDispatchService`
 * (CM.1, #620). It exports {@link InvestigationLifecycleService} for the planes that open an
 * investigation themselves (the regression watch, #623; scheduled investigations, #638).
 */

import { Module } from "@nestjs/common";

import { DbModule } from "../../db/db.module";
import { InvestigationLoopModule } from "../loop/investigation-loop.module";
import { ResearchModule } from "../research.module";
import { InvestigationLifecycleController } from "./lifecycle.controller";
import { LifecycleRepository } from "./lifecycle.repository";
import { InvestigationLifecycleService } from "./lifecycle.service";
import { ResearchSettingsController } from "./research-settings.controller";

@Module({
  imports: [DbModule, ResearchModule, InvestigationLoopModule],
  controllers: [InvestigationLifecycleController, ResearchSettingsController],
  providers: [LifecycleRepository, InvestigationLifecycleService],
  exports: [InvestigationLifecycleService],
})
export class InvestigationLifecycleModule {}
