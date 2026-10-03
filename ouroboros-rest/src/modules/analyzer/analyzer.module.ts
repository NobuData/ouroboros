/**
 * `AnalyzerModule` — the Build Analyzer's run orchestration (BV.1,
 * [#510](https://github.com/NobuData/ouroboros/issues/510), epic BV, mockup 18).
 *
 * Three triggers converge on one orchestrator:
 *
 *   * **manual** — `POST /api/v1/analyzer/runs`, administrators only, audited
 *     (`analysis.controller.ts`);
 *   * **weekly** — the schedule's slot, found by a one-minute tick that also reaps runs a stopped
 *     process left `running` (`analysis.scheduler.ts`);
 *   * **every N builds** — a counter on farm job completion, from `FarmDispatchModule`'s
 *     `JobCompletions` seam (`analysis.counter.ts`).
 *
 * The orchestrator (`analysis.orchestrator.ts`) guards against a second concurrent run, assembles
 * the corpus within the run's budgets (`corpus/`), dispatches it to the deployment's own engine
 * through `EngineModule`'s client, and writes progress, findings and the ending to the run row as
 * they happen. Nothing here sends a corpus anywhere else.
 *
 * In the `composing` phase the suggestion composer (`composer/`, BV.4,
 * [#513](https://github.com/NobuData/ouroboros/issues/513)) turns the run's findings into
 * suggestions through typed templates, with calibrated impact and documented confidence.
 *
 * The suggestion actions (`actions/`, BV.5, [#514](https://github.com/NobuData/ouroboros/issues/514))
 * preview, apply, dismiss, draft and push them — composing the farm, workflow and planning planes
 * through their own services and writing only the analyzer's tables.
 *
 * The measurement job (`measurement/`, BV.6, [#515](https://github.com/NobuData/ouroboros/issues/515))
 * judges every applied suggestion after its window — delivered, under, over or confounded — and
 * recalibrates the analyzer's factor by bounded, reproducible arithmetic; the composer applies the
 * new factor at the next composition.
 */

import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";

import { AuditModule } from "../audit/audit.module";
import { DbModule } from "../db/db.module";
import { EngineModule } from "../engine/engine.module";
import { FarmConfigModule } from "../farm/config/farm-config.module";
import { FarmDispatchModule } from "../farm/dispatch/dispatch.module";
import { PlanningModule } from "../planning/planning.module";
import { WorkflowsModule } from "../workflows/workflows.module";
import { SuggestionActionsController } from "./actions/actions.controller";
import { ActionsRepository } from "./actions/actions.repository";
import { SuggestionActionsService } from "./actions/actions.service";
import { MeasurementController } from "./measurement/measurement.controller";
import { MeasurementRepository } from "./measurement/measurement.repository";
import { MeasurementScheduler } from "./measurement/measurement.scheduler";
import { MeasurementService } from "./measurement/measurement.service";
import { AnalysisController } from "./analysis.controller";
import { AnalysisBuildCounter } from "./analysis.counter";
import { AnalysisOrchestrator } from "./analysis.orchestrator";
import { AnalysisRepository } from "./analysis.repository";
import { AnalysisScheduler } from "./analysis.scheduler";
import { AnalysisService } from "./analysis.service";
import { ComposerRepository } from "./composer/composer.repository";
import { SuggestionComposer } from "./composer/composer.service";
import { SYNTHESIZER, UnavailableSynthesizer } from "./composer/synthesis.contract";
import { CorpusAssembler } from "./corpus/corpus.assembler";
import { CorpusRepository } from "./corpus/corpus.repository";
import { AnalysisScheduleController } from "./schedule/schedule.controller";
import { AnalysisScheduleService } from "./schedule/schedule.service";

@Module({
  imports: [
    DbModule,
    AuditModule,
    EngineModule,
    FarmDispatchModule,
    FarmConfigModule,
    WorkflowsModule,
    PlanningModule,
    ScheduleModule.forRoot(),
  ],
  controllers: [
    AnalysisController,
    AnalysisScheduleController,
    SuggestionActionsController,
    MeasurementController,
  ],
  providers: [
    CorpusRepository,
    CorpusAssembler,
    AnalysisRepository,
    AnalysisOrchestrator,
    AnalysisService,
    AnalysisScheduleService,
    AnalysisScheduler,
    AnalysisBuildCounter,
    ComposerRepository,
    SuggestionComposer,
    { provide: SYNTHESIZER, useClass: UnavailableSynthesizer },
    ActionsRepository,
    SuggestionActionsService,
    MeasurementRepository,
    MeasurementService,
    MeasurementScheduler,
  ],
  exports: [AnalysisOrchestrator],
})
export class AnalyzerModule {}
