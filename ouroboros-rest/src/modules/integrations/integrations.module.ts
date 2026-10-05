/**
 * The integrations status hub (BR.4, [#488](https://github.com/NobuData/ouroboros/issues/488)): the
 * Settings grid, composed from the planes that own each connection.
 *
 * ```
 * repository  one read per owning plane — presence and counts, no credential   → integrations.repository.ts
 * tiles       the composition: availability, state, context line, deep link    → integrations.tiles.ts
 * controller  GET /settings/integrations                                       → integrations.controller.ts
 * ```
 *
 * It imports `DbModule` and nothing else: it reads the owning planes' tables directly (as
 * onboarding does), because none of those modules exports a per-workspace status read, and it
 * writes nothing, so no plane's invariants are within its reach.
 */

import { Module } from "@nestjs/common";

import { DbModule } from "../db/db.module";
import { IntegrationsController } from "./integrations.controller";
import { IntegrationsRepository } from "./integrations.repository";

@Module({
  imports: [DbModule],
  controllers: [IntegrationsController],
  providers: [IntegrationsRepository],
})
export class IntegrationsModule {}
