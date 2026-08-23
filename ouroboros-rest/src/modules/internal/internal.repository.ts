/**
 * The one statement the engine-facing surface issues: which workspace does this run belong
 * to?
 *
 * One question, one primary-key lookup, and a note about where it lives. `runs` is
 * `RunsModule`'s table and this is not that module — the convention
 * ([#30](https://github.com/NobuData/ouroboros/issues/30)) is that repositories live with
 * their feature module, so the obvious alternative was a method on `RunsRepository`. It is
 * not that for a reason that survives review: every method there takes `organizationId`
 * first and every statement filters on it, and its own suite asserts that the predicate is
 * present in each one. That is not decoration — it is what makes a run belonging to another
 * workspace *absent* rather than forbidden.
 *
 * This question runs the other way. The caller is a worker, which knows a run id and has no
 * workspace to be scoped to; the workspace is what it is asking for, indirectly, so that the
 * lease can be attributed to one. A method with no org predicate sitting among methods whose
 * whole point is the org predicate would be an exception in exactly the file where nobody
 * should have to check for exceptions. So it is here, alone, with the argument beside it.
 *
 * **It reads one column.** Not the run — the workspace. A lease does not care whether the
 * run is finished, what model it names, or whose issue it is, and a `selectAll` here would
 * be handing this module a row it has no business reading.
 */

import { Injectable } from "@nestjs/common";

import { DatabaseService } from "../db/db.service";

@Injectable()
export class InternalRepository {
  /**
   * @param database - The typed connection. Injected, never constructed: the pool's
   *   lifecycle belongs to `DatabaseService`.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * The workspace a run belongs to.
   *
   * @param run - The run's id, already validated as a uuid by the DTO — so a malformed value
   *   is a `422` from the pipe rather than a type error from the driver.
   * @returns The workspace's id, or `undefined` when no such run exists. `undefined` rather
   *   than a throw: *no such run* is an answer this repository can give truthfully, and what
   *   to tell the caller about it is the surface's decision, not the query's.
   */
  async organizationOfRun(run: string): Promise<string | undefined> {
    const row = await this.database.db
      .selectFrom("runs")
      .select("organization_id")
      .where("id", "=", run)
      .executeTakeFirst();

    return row?.organization_id;
  }
}
