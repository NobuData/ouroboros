/**
 * `RepoMapModule` — the nightly `repo-map` generator and its manual regenerate, under
 * `/api/v1/knowledge/repo-map` (BF.6, [#415](https://github.com/NobuData/ouroboros/issues/415),
 * decision **K2**).
 *
 * ```
 * repo-map.render      tree + CODEOWNERS + detections ─▶ deterministic markdown (pure)
 * repo-map.repository  the repositories to map, each one's generated skill
 * repo-map.service     generate (diff-aware), generateAll (nightly), regenerate (debounced)
 * repo-map.scheduler   the nightly slot — OURO_REPO_MAP_HOUR_UTC
 * repo-map.controller  POST regenerate
 * ```
 *
 * It reads the repository through `DetectionModule`'s probe machinery (#384, over the provider SPI
 * #140) and writes the skill with the registry's own statements, `SkillsRepository` — provided
 * here as BF.4's import provides it, so `SkillsModule` keeps its one export.
 */

import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";

import { AuditModule } from "../audit/audit.module";
import { DbModule } from "../db/db.module";
import { DetectionModule } from "../detection/detection.module";
import { SkillsRepository } from "../skills/skills.repository";
import { RepoMapController } from "./repo-map.controller";
import { RepoMapRepository } from "./repo-map.repository";
import { RepoMapScheduler } from "./repo-map.scheduler";
import { RepoMapService } from "./repo-map.service";

@Module({
  imports: [DbModule, AuditModule, DetectionModule, ScheduleModule.forRoot()],
  controllers: [RepoMapController],
  providers: [RepoMapService, RepoMapRepository, RepoMapScheduler, SkillsRepository],
})
export class RepoMapModule {}
