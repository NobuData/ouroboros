/**
 * A dry run read back whole — the row, its ticket, its result rows and its artifacts, as one
 * resource (CD.4, [#562](https://github.com/NobuData/ouroboros/issues/562)).
 *
 * One composition, used by every surface that shows a dry run: the answer to a start, a re-run,
 * a cancel and a read, and the `accepted` and `done` events of the stream. So a card built from
 * the stream and a card built from a reload are the same card.
 */

import { Injectable } from "@nestjs/common";

import type { DryRun } from "../db/schema";
import type { DryRunBudget } from "./dry-runs.budget";
import { DryRunsRepository } from "./dry-runs.repository";
import { dryRunResource, type DryRunResource } from "./dry-runs.resources";

@Injectable()
export class DryRunRecords {
  /** @param dryRuns - The statements. */
  constructor(private readonly dryRuns: DryRunsRepository) {}

  /**
   * One dry run, with everything recorded about it so far.
   *
   * @param run - The row, already resolved for this workspace.
   * @param budget - The budget it was started under, on a start's answer.
   * @returns The resource.
   * @throws {Error} When the run's ticket is gone — which the cascade from `tickets` makes
   *   impossible while the run exists.
   */
  async resource(run: DryRun, budget?: DryRunBudget): Promise<DryRunResource> {
    const [ticket, stages, artifacts] = await Promise.all([
      this.dryRuns.ticket(run.organization_id, run.ticket_id),
      this.dryRuns.stages(run.id),
      this.dryRuns.artifacts(run.id),
    ]);

    if (ticket === undefined) {
      throw new Error(`dry run ${run.id} names a ticket that no longer exists`);
    }

    return dryRunResource(run, ticket, stages, artifacts, budget);
  }
}
