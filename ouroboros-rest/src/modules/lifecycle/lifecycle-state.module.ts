/**
 * The lifecycle state, for the modules that consult it (BR.5,
 * [#489](https://github.com/NobuData/ouroboros/issues/489)).
 *
 * ```
 * WorkspaceStateReader   where a workspace stands            → ingest, tenancy, lifecycle
 * LifecycleDispatchGate  the farm's FARM_DISPATCH_GATE answer → farm dispatch
 * WorkspaceFreezeGuard   the pending_delete freeze            → tenancy (global guard)
 * ```
 *
 * Separate from `LifecycleModule`, which *changes* the state, so the consumers import a reader
 * and nothing that can write.
 */

import { Module } from "@nestjs/common";

import { DbModule } from "../db/db.module";
import { WorkspaceFreezeGuard } from "./lifecycle.freeze.guard";
import { LifecycleDispatchGate, WorkspaceStateReader } from "./lifecycle.state";

@Module({
  imports: [DbModule],
  providers: [WorkspaceStateReader, LifecycleDispatchGate, WorkspaceFreezeGuard],
  exports: [WorkspaceStateReader, LifecycleDispatchGate, WorkspaceFreezeGuard],
})
export class LifecycleStateModule {}
