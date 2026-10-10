/**
 * `BriefsModule` — the deliverable made readable (CM.2,
 * [#621](https://github.com/NobuData/ouroboros/issues/621)): the brief read model, the sources
 * panel and ledger, the capability matrix builder and the Markdown export.
 *
 * Exports {@link BriefsService} — the proposed-from-gaps summary and the export #624 builds on —
 * and {@link MatrixBuilderService}, which the investigation loop calls when a gap analysis
 * delivers.
 */

import { Module } from "@nestjs/common";

import { DbModule } from "../../db/db.module";
import { BriefsController } from "./briefs.controller";
import { BriefsRepository } from "./briefs.repository";
import { BriefsService } from "./briefs.service";
import { MatrixBuilderService } from "./matrix-builder.service";

@Module({
  imports: [DbModule],
  controllers: [BriefsController],
  providers: [BriefsRepository, BriefsService, MatrixBuilderService],
  exports: [BriefsService, MatrixBuilderService],
})
export class BriefsModule {}
