/**
 * The workspace lifecycle — mockup 17's Danger zone as mechanism (BR.5,
 * [#489](https://github.com/NobuData/ouroboros/issues/489)).
 *
 * ```
 * controller  the routes, the role gates                 → lifecycle.controller.ts
 * service     pause · resume · disconnect · delete · restore → lifecycle.service.ts
 * purge       day 30: DEK · artifacts · rows · tombstone  → lifecycle.purge.ts
 * scheduler   when the purge runs                        → lifecycle.scheduler.ts
 * repository  the statements                             → lifecycle.repository.ts
 * auth        BetterAuth's rows, through the library     → lifecycle.auth.ts
 * ```
 *
 * Consumers that only *read* the state — farm dispatch, run ingestion, the tenant freeze —
 * import `LifecycleStateModule` instead, which can write nothing.
 *
 * `LifecycleService` is exported for one caller: `/ouro pause all confirm` (BZ.3,
 * [#537](https://github.com/NobuData/ouroboros/issues/537)), which is the Danger zone's *Pause all
 * loops* typed in chat and so calls the same `pause()` — its confirmation, its state check and its
 * audit event. The owner/admin gate the route carries is the dispatcher's there.
 */

import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";

import { AuditModule } from "../audit/audit.module";
import { ControlsModule } from "../controls/controls.module";
import { DbModule } from "../db/db.module";
import { FarmArtifactsModule } from "../farm/artifacts/artifacts.module";
import { GithubModule } from "../github/github.module";
import { StepUpModule } from "../provider-connections/step-up.module";
import { VaultModule } from "../vault/vault.module";
import { BetterAuthWorkspaceStore, WORKSPACE_AUTH_STORE } from "./lifecycle.auth";
import { LifecycleController } from "./lifecycle.controller";
import { LifecyclePurge } from "./lifecycle.purge";
import { LifecycleRepository } from "./lifecycle.repository";
import { LifecyclePurgeScheduler } from "./lifecycle.scheduler";
import { LifecycleService } from "./lifecycle.service";
import { LifecycleStateModule } from "./lifecycle-state.module";

@Module({
  imports: [
    DbModule,
    ScheduleModule.forRoot(),
    LifecycleStateModule,
    AuditModule,
    // A pause reaches the live runs already executing through their control queue (DI.4, #1312).
    ControlsModule,
    VaultModule,
    GithubModule,
    StepUpModule,
    FarmArtifactsModule,
  ],
  controllers: [LifecycleController],
  providers: [
    LifecycleRepository,
    LifecycleService,
    LifecyclePurge,
    LifecyclePurgeScheduler,
    { provide: WORKSPACE_AUTH_STORE, useClass: BetterAuthWorkspaceStore },
  ],
  exports: [LifecyclePurge, LifecycleService],
})
export class LifecycleModule {}
