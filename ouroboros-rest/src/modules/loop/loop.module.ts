/**
 * The loop capability report (DG.2, [#1300](https://github.com/NobuData/ouroboros/issues/1300)):
 * `GET /api/v1/loop/capabilities`.
 *
 * It reads; it owns no table. The engine's status comes through `EngineModule`, the dry-run
 * policy through `PoliciesModule`, and the two workspace reads are its own repository's.
 */

import { Module } from "@nestjs/common";

import { DbModule } from "../db/db.module";
import { EngineModule } from "../engine/engine.module";
import { PoliciesModule } from "../policies/policies.module";
import { LoopCapabilitiesController } from "./loop.controller";
import { LoopRepository } from "./loop.repository";
import { LoopCapabilitiesService } from "./loop.service";

@Module({
  imports: [DbModule, EngineModule, PoliciesModule],
  controllers: [LoopCapabilitiesController],
  providers: [LoopRepository, LoopCapabilitiesService],
})
export class LoopModule {}
