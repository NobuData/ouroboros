/**
 * Reading a workspace's lifecycle state — the one question every dispatch point asks (BR.5,
 * [#489](https://github.com/NobuData/ouroboros/issues/489)).
 *
 * Kept apart from the lifecycle service so the modules that only *consult* the state — farm
 * dispatch, run ingestion and the tenant freeze — import one small reader rather than the
 * module that changes it, and so none of them can come to depend on each other through it.
 *
 * **Not cached, on purpose.** The hold has to take effect within one poll interval of a pause,
 * and a cache is a second interval nobody documented. One primary-key read is what it costs.
 */

import { Injectable } from "@nestjs/common";

import { DatabaseService } from "../db/db.service";
import type { WorkspaceLifecycleState } from "../db/schema";
import type { DispatchGate } from "../farm/dispatch/dispatch.gate";
import { admitsNewWork } from "./lifecycle.states";

/** Where a workspace stands, as every consumer reads it. */
export interface WorkspaceStanding {
  /** `active`, `paused` or `pending_delete`. */
  readonly state: WorkspaceLifecycleState;
  /** When the recovery window closes; non-null exactly while `pending_delete`. */
  readonly purgeAfter: Date | null;
  /** When the state last changed, or null for a workspace that has never left `active`. */
  readonly changedAt: Date | null;
  /** Who changed it last, or null. */
  readonly changedBy: string | null;
}

/** The standing of a workspace that has no lifecycle row — every workspace, until it is paused. */
export const ACTIVE_STANDING: WorkspaceStanding = {
  state: "active",
  purgeAfter: null,
  changedAt: null,
  changedBy: null,
};

@Injectable()
export class WorkspaceStateReader {
  /** @param database - The typed connection. */
  constructor(private readonly database: DatabaseService) {}

  /**
   * Where a workspace stands.
   *
   * @param organizationId - The workspace.
   * @returns Its standing; {@link ACTIVE_STANDING} when it has no row.
   */
  async standing(organizationId: string): Promise<WorkspaceStanding> {
    const row = await this.database.db
      .selectFrom("workspace_lifecycle")
      .select(["state", "purge_after", "changed_at", "changed_by"])
      .where("organization_id", "=", organizationId)
      .executeTakeFirst();

    if (row === undefined) {
      return ACTIVE_STANDING;
    }

    return {
      state: row.state,
      purgeAfter: row.purge_after,
      changedAt: row.changed_at,
      changedBy: row.changed_by,
    };
  }

  /**
   * Just the state.
   *
   * @param organizationId - The workspace.
   * @returns `active`, `paused` or `pending_delete`.
   */
  async stateOf(organizationId: string): Promise<WorkspaceLifecycleState> {
    return (await this.standing(organizationId)).state;
  }
}

/**
 * The farm's dispatch gate, answered from the lifecycle state — what #489 binds to
 * `FARM_DISPATCH_GATE` in place of the open gate.
 *
 * The dispatcher asks once per workspace per pass, before it offers anything, and a pass is at
 * most `DISPATCH_INTERVAL_MS` (2 s, jittered) after the last: that is the documented interval
 * within which a pause holds the farm. Builds already offered, accepted or running are untouched.
 */
@Injectable()
export class LifecycleDispatchGate implements DispatchGate {
  /** @param states - Where each workspace stands. */
  constructor(private readonly states: WorkspaceStateReader) {}

  /**
   * @param organizationId - The workspace whose waiting builds are about to be offered.
   * @returns `true` only while the workspace is `active`.
   */
  async admits(organizationId: string): Promise<boolean> {
    return admitsNewWork(await this.states.stateOf(organizationId));
  }
}
