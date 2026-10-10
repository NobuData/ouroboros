/**
 * The gaps hand-off and the roadmap-doc pipeline (CM.5,
 * [#624](https://github.com/NobuData/ouroboros/issues/624)).
 *
 * The module composes four planes it does not own: **briefs** (the export and the proposal),
 * **skills** (the registry `create-roadmap` and `create-issues` live in — `SkillsRepository` is
 * provided here as the repo-map generator provides it, since the skills module exports only its
 * read service), **Planning** (drafts, the sizer behind them, the one push path) and **ticket
 * sources** (the repository a document is projected into). It adds no second way to do any of
 * what they do.
 */

import { Module } from "@nestjs/common";

import { AuditModule } from "../../audit/audit.module";
import { AppConfigService } from "../../config/config.service";
import { DbModule } from "../../db/db.module";
import { EngineModule } from "../../engine/engine.module";
import { PlanningModule } from "../../planning/planning.module";
import { PoliciesModule } from "../../policies/policies.module";
import { RoutingModule } from "../../routing/routing.module";
import { SkillsRepository } from "../../skills/skills.repository";
import { TicketSourcesModule } from "../../ticket-sources/ticket-sources.module";
import { BriefsModule } from "../briefs/briefs.module";
import { GapHandoffService } from "./gap-handoff.service";
import { PipelineController } from "./pipeline.controller";
import { ProviderRepoGateway } from "./pipeline.repo";
import { PipelineRepository } from "./pipeline.repository";
import { PipelineSkillRegistry } from "./pipeline.skill-registry";
import { PipelineSkillRunner } from "./pipeline.skill-runner";
import { RoadmapDriftService } from "./roadmap.drift.service";
import { RoadmapIssuesService } from "./roadmap.issues.service";
import { RoadmapProjector } from "./roadmap.projector";
import { RoadmapScheduler } from "./roadmap.scheduler";
import { RoadmapService } from "./roadmap.service";

@Module({
  imports: [
    DbModule,
    AuditModule,
    EngineModule,
    RoutingModule,
    PoliciesModule,
    PlanningModule,
    TicketSourcesModule,
    BriefsModule,
  ],
  controllers: [PipelineController],
  providers: [
    PipelineRepository,
    SkillsRepository,
    PipelineSkillRegistry,
    PipelineSkillRunner,
    ProviderRepoGateway,
    RoadmapProjector,
    RoadmapService,
    RoadmapIssuesService,
    RoadmapDriftService,
    GapHandoffService,
    {
      provide: RoadmapScheduler,
      inject: [RoadmapDriftService, AppConfigService],
      useFactory: (drift: RoadmapDriftService, config: AppConfigService) =>
        new RoadmapScheduler(drift, config.researchRoadmapTickMs),
    },
  ],
  exports: [RoadmapService, GapHandoffService],
})
export class RoadmapPipelineModule {}
