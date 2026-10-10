/**
 * `RegressionWatchModule` — mockup 22's regression watch as a service (CM.4,
 * [#623](https://github.com/NobuData/ouroboros/issues/623); decision V6).
 *
 * It owns the watch's own steps — capture, compare, the chain — and composes every plane the
 * chain touches through that plane's exported service: the telemetry tool and the ledger
 * ({@link ResearchToolsModule}), the bisect primitive ({@link CodeModule}), the estimate and the
 * investigation loop's dispatch ({@link ResearchModule}, {@link InvestigationLoopModule}),
 * Planning's batches ({@link PlanningModule}), the backlog queue ({@link BacklogModule}), the
 * inbox ({@link DecisionsModule}) and the audit log ({@link AuditModule}).
 *
 * It exports {@link RegressionWatchService} for the inbox's **Dismiss drift** action.
 */

import { Module, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";

import { AuditModule } from "../../audit/audit.module";
import { BacklogModule } from "../../backlog/backlog.module";
import { AppConfigService } from "../../config/config.service";
import { DbModule } from "../../db/db.module";
import { DecisionsModule } from "../../decisions/decisions.module";
import { DecisionSourceWatcher } from "../../decisions/decision.watchers";
import { PlanningModule } from "../../planning/planning.module";
import { CodeModule } from "../code/code.module";
import { InvestigationLoopModule } from "../loop/investigation-loop.module";
import { ResearchModule } from "../research.module";
import { ResearchToolsModule } from "../tools/research-tools.module";
import { RegressionWatchChain } from "./watch.chain";
import { RegressionWatchController } from "./watch.controller";
import { watchMovedOnDetector } from "./watch.inbox";
import { RegressionWatchInternalController } from "./watch.internal.controller";
import { WatchRepository } from "./watch.repository";
import { RegressionWatchScheduler } from "./watch.scheduler";
import { RegressionWatchService } from "./watch.service";

@Module({
  imports: [
    DbModule,
    AuditModule,
    BacklogModule,
    DecisionsModule,
    PlanningModule,
    CodeModule,
    ResearchModule,
    ResearchToolsModule,
    InvestigationLoopModule,
  ],
  controllers: [RegressionWatchController, RegressionWatchInternalController],
  providers: [
    WatchRepository,
    RegressionWatchService,
    RegressionWatchChain,
    {
      provide: RegressionWatchScheduler,
      inject: [WatchRepository, RegressionWatchService, RegressionWatchChain, AppConfigService],
      useFactory: (
        repository: WatchRepository,
        watch: RegressionWatchService,
        chain: RegressionWatchChain,
        config: AppConfigService,
      ) => new RegressionWatchScheduler(repository, watch, chain, config.researchRegressionTickMs),
    },
  ],
  exports: [RegressionWatchService],
})
export class RegressionWatchModule implements OnModuleInit, OnModuleDestroy {
  private stop: (() => void) | undefined;

  /** @param watcher - Where the watch's cards learn their item moved on. */
  constructor(private readonly watcher: DecisionSourceWatcher) {}

  /** Register how a watch card settles out of band. */
  onModuleInit(): void {
    this.stop = this.watcher.register(watchMovedOnDetector());
  }

  /** Unregister. */
  onModuleDestroy(): void {
    this.stop?.();
    this.stop = undefined;
  }
}
