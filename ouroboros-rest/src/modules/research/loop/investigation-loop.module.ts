/**
 * The investigation loop's control-plane half (CM.1,
 * [#620](https://github.com/NobuData/ouroboros/issues/620)): the internal routes the engine's
 * loop writes through, the dispatcher that hands investigations to it, and the resume pass.
 *
 * `InvestigationDispatchService` is exported for the lifecycle API (CM.6, #625), which starts
 * and cancels investigations on a person's behalf.
 */

import { Module } from "@nestjs/common";

import { AppConfigService } from "../../config/config.service";
import { DbModule } from "../../db/db.module";
import { EngineModule } from "../../engine/engine.module";
import { RoutingModule } from "../../routing/routing.module";
import { BriefsModule } from "../briefs/briefs.module";
import { ResearchModule } from "../research.module";
import { ResearchToolsModule } from "../tools/research-tools.module";
import { InvestigationDispatchService } from "./investigation-dispatch.service";
import { InvestigationLoopRepository } from "./investigation-loop.repository";
import { InvestigationLoopScheduler } from "./investigation-loop.scheduler";
import { InvestigationLoopService } from "./investigation-loop.service";
import { InvestigationsInternalController } from "./investigations.internal.controller";

@Module({
  imports: [
    DbModule,
    EngineModule,
    RoutingModule,
    ResearchModule,
    ResearchToolsModule,
    BriefsModule,
  ],
  controllers: [InvestigationsInternalController],
  providers: [
    InvestigationLoopRepository,
    InvestigationLoopService,
    InvestigationDispatchService,
    {
      provide: InvestigationLoopScheduler,
      inject: [InvestigationDispatchService, AppConfigService],
      useFactory: (dispatch: InvestigationDispatchService, config: AppConfigService) =>
        new InvestigationLoopScheduler(dispatch, config.researchInvestigationTickMs),
    },
  ],
  exports: [InvestigationDispatchService],
})
export class InvestigationLoopModule {}
