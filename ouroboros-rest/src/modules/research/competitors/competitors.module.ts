/**
 * The competitor registry's module (CL.3, [#616](https://github.com/NobuData/ouroboros/issues/616)):
 * the registry routes and the change feed, and the repository the tracker adapter reads and
 * writes through (`research-tools.module.ts` imports this module for it).
 */

import { Module } from "@nestjs/common";

import { DbModule } from "../../db/db.module";
import { CompetitorsController } from "./competitors.controller";
import { CompetitorsRepository } from "./competitors.repository";
import { CompetitorsService } from "./competitors.service";

@Module({
  imports: [DbModule],
  controllers: [CompetitorsController],
  providers: [CompetitorsRepository, CompetitorsService],
  exports: [CompetitorsRepository],
})
export class CompetitorsModule {}
