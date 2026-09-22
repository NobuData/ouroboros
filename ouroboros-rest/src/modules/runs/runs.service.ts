/**
 * The rules of the runs listings ([#71](https://github.com/NobuData/ouroboros/issues/71)),
 * which are two:
 *
 *   * **A run row has exactly one shape everywhere.** Every row here is built by
 *     `dashboard/resources.ts`'s `runSummary` — the same function the aggregate's
 *     `activeRuns` and `recentRuns` slices go through — so the ticket's byte-identity
 *     criterion is met by construction: there is no second mapper whose fields could drift.
 *     Importing the mapper across the module boundary is deliberately not importing the
 *     module: `runSummary` is a pure function over a row, the dashboard's *providers* stay
 *     unexported, and its card-sized limits stay its own.
 *   * **Absence answers 404, and absence includes "not yours".** The repository's org-scoped
 *     `find` cannot distinguish a run that never existed from a run in another workspace,
 *     so neither can a caller — which is the no-existence-leak criterion as an
 *     information-flow property rather than a check. The one-run read became the Run
 *     Console's page in AP.2 ([#304](https://github.com/NobuData/ouroboros/issues/304)) and
 *     lives in `console.service.ts`, which carries this row inside it as `run` and starts from
 *     the same `find`.
 */

import { Injectable } from "@nestjs/common";

import { runSummary, type RunSummary } from "../dashboard/resources";
import { pageOf, windowOf, type Page } from "../tenancy/pagination";
import type { ListRunsQuery } from "./runs.dto";
import { RunsRepository } from "./runs.repository";

@Injectable()
export class RunsService {
  constructor(private readonly runs: RunsRepository) {}

  /**
   * One page of the workspace's runs.
   *
   * The rows and the total are read concurrently — two statements over the same indexed
   * predicates, per the dashboard repository's argument that the round trip costs more than
   * the statement it carries.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param query - The family, the optional repository, and the window.
   * @returns The page, in the family's documented order.
   */
  async list(organizationId: string, query: ListRunsQuery): Promise<Page<RunSummary>> {
    const window = windowOf(query);
    const filter = { status: query.status, repoId: query.repo };

    const [rows, total] = await Promise.all([
      this.runs.list(organizationId, filter, window),
      this.runs.count(organizationId, filter),
    ]);

    return pageOf(rows.map(runSummary), total, window);
  }
}
