/**
 * The history index's module (CL.5, [#618](https://github.com/NobuData/ouroboros/issues/618)):
 * the imported-document-set routes, and the repository the `tickets` research tool reads through
 * (`research-tools.module.ts` imports this module for it; #636's embedding index will too).
 */

import { Module } from "@nestjs/common";

import { DbModule } from "../../db/db.module";
import { DocumentImportsController } from "./document-imports.controller";
import { DocumentImportsService } from "./document-imports.service";
import { HistoryIndexRepository } from "./history-index.repository";

@Module({
  imports: [DbModule],
  controllers: [DocumentImportsController],
  providers: [HistoryIndexRepository, DocumentImportsService],
  exports: [HistoryIndexRepository],
})
export class HistoryModule {}
