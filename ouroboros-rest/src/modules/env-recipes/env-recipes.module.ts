/**
 * `EnvRecipesModule` — a repository's environment recipe, read and versioned under
 * `/api/v1/knowledge/env-recipe` (V073's table; BG.4,
 * [#420](https://github.com/NobuData/ouroboros/issues/420)).
 *
 * ```
 * env-recipes.resources   the shape and the row mapper (pure)
 * env-recipes.repository  org-scoped statements: the current view, the next-version insert
 * env-recipes.service     read, save-as-next-version, audited
 * env-recipes.controller  the two routes
 * ```
 *
 * It exports nothing: the consumers V073 names (farm setup, prebuilds, workspace prep) read the
 * view themselves when they arrive, and nothing in this process composes over the service.
 */

import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";
import { DbModule } from "../db/db.module";
import { EnvRecipesController } from "./env-recipes.controller";
import { EnvRecipesRepository } from "./env-recipes.repository";
import { EnvRecipesService } from "./env-recipes.service";

@Module({
  imports: [DbModule, AuditModule],
  controllers: [EnvRecipesController],
  providers: [EnvRecipesService, EnvRecipesRepository],
})
export class EnvRecipesModule {}
