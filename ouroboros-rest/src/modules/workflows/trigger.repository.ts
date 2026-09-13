/**
 * The one statement R.1's trigger service issues
 * ([#143](https://github.com/NobuData/ouroboros/issues/143)).
 *
 * ```
 * triggers()  every workflow of one workspace, with the trigger of the version in force — one read
 * ```
 *
 * ## One read per queue write, not one per ticket
 *
 * A bulk queue of a hundred issues needs every candidate's trigger *and* the version in force of
 * any slug an issue might fall back to — its estimate's suggestion, or the request's explicit
 * choice. Both are answered by the same rows, so they are read once and `trigger.service.ts`
 * builds the candidate list and the version lookup from them. Every status comes back, because
 * the version lookup has to answer for a suggestion that names a paused workflow too; which rows
 * may *match* is the service's rule, not this statement's.
 *
 * ## The trigger is read in PostgreSQL, and nothing else of the document is
 *
 * A definition holds a prompt template per model stage — up to 20 000 characters each — and
 * this read is on the path of every queue write. `definition -> 'trigger'` sends only the
 * predicate, which is `stats.repository.ts`' argument about stage counts applied here.
 *
 * ## Org scoping is not optional and is not the client's
 *
 * The workspace is the tenant context's, and the statement filters on it: a workflow belonging
 * to another workspace is never a candidate, so it can never claim this workspace's ticket.
 * `trigger.repository.spec.ts` asserts the predicate is in the compiled statement.
 */

import { Injectable } from "@nestjs/common";
import { sql } from "kysely";

import { DatabaseService } from "../db/db.service";
import type { WorkflowStatus } from "../db/schema";

/** One workflow, and the trigger of the version it has in force. */
export interface WorkflowTriggerRow {
  /** The workflow's slug. */
  readonly slug: string;
  /** `active`, `paused` or `archived`. Only `active` may match. */
  readonly status: WorkflowStatus;
  /** Which published version is in force, or `null` for a workflow that has only a draft. */
  readonly current_version: number | null;
  /**
   * `definition -> 'trigger'` of that version, **unvalidated** — `null` when nothing is in force.
   *
   * `unknown` on purpose: the column promises an object and nothing more, so the service parses
   * it with the DSL's own schema before trusting a field of it.
   */
  readonly trigger: unknown;
}

@Injectable()
export class TriggerRepository {
  /**
   * @param database - The typed connection. Injected, never constructed: the pool's lifecycle
   *   belongs to `DatabaseService`.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * Every workflow of one workspace, with the trigger of its version in force.
   *
   * **Through `current_version`, not the newest version.** V029 is emphatic that the pointer is a
   * pointer: a rollback moves it to an older version, and that older version is what a queued
   * ticket must be pinned to.
   *
   * **A left join**, so a draft-only workflow still comes back — with a `null` version and a
   * `null` trigger — because the version lookup has to be able to say it has nothing to pin.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @returns One row per workflow, archived included, ordered by slug so the answer is stable.
   */
  async triggers(organizationId: string): Promise<WorkflowTriggerRow[]> {
    return this.database.db
      .selectFrom("workflows as w")
      .leftJoin("workflow_versions as v", (join) =>
        join.onRef("v.workflow_id", "=", "w.id").onRef("v.version", "=", "w.current_version"),
      )
      .select([
        "w.slug as slug",
        "w.status as status",
        "w.current_version as current_version",
        sql<unknown>`${sql.ref("v.definition")} -> 'trigger'`.as("trigger"),
      ])
      .where("w.organization_id", "=", organizationId)
      .orderBy("w.slug", "asc")
      .execute();
  }
}
