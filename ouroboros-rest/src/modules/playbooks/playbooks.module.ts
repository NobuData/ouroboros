/**
 * `PlaybooksModule` — recipes learned from runs and launched onto issues, under
 * `/api/v1/knowledge/playbooks` (BF.6, [#415](https://github.com/NobuData/ouroboros/issues/415)).
 *
 * ```
 * playbooks.derive      overrides from a manifest, steer notes, V072's jsonb documents (pure)
 * playbooks.resources   the shapes and the row mapper
 * playbooks.repository  org-scoped statements; the filter is V072's own function
 * playbooks.service     CRUD, create-from-run, the picker, launch, counts
 * playbooks.controller  the routes
 * ```
 *
 * It composes, and owns no machinery of its own: `BacklogModule`'s queue write (#112) with the
 * pin R.1 (#143) stores, and `ContextAssemblyModule`'s resolution (#414).
 */

import { Module } from "@nestjs/common";

import { BacklogModule } from "../backlog/backlog.module";
import { ContextAssemblyModule } from "../context-assembly/context-assembly.module";
import { DbModule } from "../db/db.module";
import { PlaybooksController } from "./playbooks.controller";
import { PlaybooksRepository } from "./playbooks.repository";
import { PlaybooksService } from "./playbooks.service";

@Module({
  imports: [DbModule, BacklogModule, ContextAssemblyModule],
  controllers: [PlaybooksController],
  providers: [PlaybooksService, PlaybooksRepository],
})
export class PlaybooksModule {}
