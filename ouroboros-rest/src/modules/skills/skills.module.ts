/**
 * `SkillsModule` — the knowledge domain's skills registry under `/api/v1/skills` (BF.1,
 * [#410](https://github.com/NobuData/ouroboros/issues/410)).
 *
 * ```
 * skills.frontmatter        markdown + YAML frontmatter ⇄ {frontmatter, body}, V069's shape
 * skills.repository         V069's skills/skill_versions; workflow references; V071's injections
 * skills.scope              a scope move's reach, references, clashes and preview token (pure)
 * skills.usage              the Used-by rule over injection records (pure)
 * skills.service            SkillsService — lifecycle, required lock, guards, preview, stats
 * skills.registry.service   SkillsRegistryService — the catalog/inspector/code-view reads
 * skills.controller         the routes
 * ```
 *
 * **Only `SkillsRegistryService` is exported.** `WorkflowsModule` imports this module for the
 * three reads that make its catalog, its P7 reference check and its code-view tree read registry
 * truth; this module reads workflow references with its own SQL and imports nothing of the
 * workflow module's, so there is no cycle.
 */

import { Module } from "@nestjs/common";

import { DbModule } from "../db/db.module";
import { SkillsController } from "./skills.controller";
import { SkillsRegistryService } from "./skills.registry.service";
import { SkillsRepository } from "./skills.repository";
import { SkillsService } from "./skills.service";

@Module({
  imports: [DbModule],
  controllers: [SkillsController],
  providers: [SkillsService, SkillsRegistryService, SkillsRepository],
  exports: [SkillsRegistryService],
})
export class SkillsModule {}
