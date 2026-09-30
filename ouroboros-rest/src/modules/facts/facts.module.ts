/**
 * The fact lifecycle and the staleness sweep (BF.2,
 * [#411](https://github.com/NobuData/ouroboros/issues/411)).
 *
 *   * `facts.controller.ts` — `/api/v1/facts`: the card, the needs-you feed, the transitions,
 *     anchors, and an on-demand sweep.
 *   * `facts.service.ts` — the lifecycle; `FactsService.propose` is the entry point BF.3 (#412)
 *     and BF.4 (#413) call, which is why it is exported.
 *   * `facts.sweep.ts` — the staleness sweep; bound to `FACT_COMMIT_OBSERVER`, the port PR sync
 *     reports a merge to.
 *   * `facts.scheduler.ts` — the nightly pass.
 *   * `facts.lifecycle.ts`, `facts.anchors.ts`, `facts.resources.ts` — pure rules and mappers.
 */

import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";

import { DbModule } from "../db/db.module";
import { FactsController } from "./facts.controller";
import { FACT_COMMIT_OBSERVER } from "./facts.observer";
import { FactsRepository } from "./facts.repository";
import { FactSweepScheduler } from "./facts.scheduler";
import { FactsService } from "./facts.service";
import { FactSweepService } from "./facts.sweep";

@Module({
  imports: [DbModule, ScheduleModule.forRoot()],
  controllers: [FactsController],
  providers: [
    FactsRepository,
    FactsService,
    FactSweepService,
    FactSweepScheduler,
    { provide: FACT_COMMIT_OBSERVER, useExisting: FactSweepService },
  ],
  exports: [FactsService, FACT_COMMIT_OBSERVER],
})
export class FactsModule {}
