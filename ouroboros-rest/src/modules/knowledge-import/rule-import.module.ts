/**
 * `RuleImportModule` — **Import CLAUDE.md / .cursorrules** under `/api/v1/knowledge/import` (BF.4,
 * [#413](https://github.com/NobuData/ouroboros/issues/413)).
 *
 * ```
 * rule-import.parse       a rules file → skill drafts + fact candidates (pure, deterministic)
 * rule-import.plan        dedupe, slugs, fingerprint — the one plan preview and apply share (pure)
 * rule-import.resources   the preview/result shapes; the stored frontmatter and provenance
 * rule-import.repository  what a plan dedupes against; the per-repository apply lock
 * rule-import.service     probe (DetectionService.readFiles) → plan → write, audited
 * rule-import.controller  the two routes
 * ```
 *
 * **It writes through the registries' own statements.** `SkillsRepository` and `FactsRepository`
 * are provided here rather than exported from their modules — both are stateless over the pool,
 * and their modules keep their deliberately narrow exports. It imports `FactsModule` for one thing
 * only, the Needs-You `FactReviewEmitter` (#461): each imported proposal files its review card.
 */

import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";
import { DbModule } from "../db/db.module";
import { DetectionModule } from "../detection/detection.module";
import { FactsModule } from "../facts/facts.module";
import { FactsRepository } from "../facts/facts.repository";
import { SkillsRepository } from "../skills/skills.repository";
import { RuleImportController } from "./rule-import.controller";
import { RuleImportRepository } from "./rule-import.repository";
import { RuleImportService } from "./rule-import.service";

@Module({
  imports: [DbModule, AuditModule, DetectionModule, FactsModule],
  controllers: [RuleImportController],
  providers: [RuleImportService, RuleImportRepository, SkillsRepository, FactsRepository],
})
export class RuleImportModule {}
