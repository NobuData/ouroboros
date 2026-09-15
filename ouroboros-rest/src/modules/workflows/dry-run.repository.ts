/**
 * The one statement the studio's dry run issues — S.6
 * ([#152](https://github.com/NobuData/ouroboros/issues/152)).
 *
 * A dry run walks a definition for one ticket, and the engine fetches nothing: *"the ticket is
 * what the caller sends"*. So this service is what turns the issue a person picked into the three
 * facts a predicate can test — its labels, its effort, and where it came from — and the key every
 * explanation names it by.
 *
 * **Read here rather than borrowed from the backlog.** `BacklogModule` already imports this
 * module for the queue write's trigger pin, so injecting a backlog repository into it would be the
 * cycle `.dependency-cruiser.cjs` refuses. The statement is small and is the shape of
 * `backlog/queue.repository.ts`' `selection`: the issue, and the estimate in force through a
 * lateral, because re-estimation is a new row and the highest version wins (decision **K4**).
 *
 * **Org-scoped, like every statement reachable from a request.** An id that names an issue in
 * another workspace matches nothing, which is what lets the service answer it with the same `404`
 * as an id that names nothing at all.
 */

import { Injectable } from "@nestjs/common";

import { DatabaseService } from "../db/db.service";
import type { EstimateEffort } from "../db/schema";

/** One issue, reduced to what a dry run can test. */
export interface DryRunIssue {
  /** The GitHub number — the `485` a ticket is named `#485` by. */
  readonly number: number;
  /** The tracker's label names, as the last sync stored them. */
  readonly labels: readonly string[];
  /** The effort of the estimate in force, or `null` for an issue nobody has sized. */
  readonly effort: EstimateEffort | null;
}

@Injectable()
export class WorkflowDryRunRepository {
  /**
   * @param database - The typed connection. Injected, never constructed: the pool's lifecycle
   *   belongs to `DatabaseService`.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * One issue of this workspace, with the effort of its estimate in force.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param issueId - `github_issues.id`, already validated as a uuid by the pipe.
   * @returns The issue, or `undefined` when the id names nothing this workspace holds — including
   *   an issue that is another workspace's.
   */
  async issue(organizationId: string, issueId: string): Promise<DryRunIssue | undefined> {
    const row = await this.database.db
      .selectFrom("github_issues")
      .leftJoinLateral(
        (eb) =>
          eb
            .selectFrom("issue_estimates")
            .select("issue_estimates.effort as effort")
            .whereRef("issue_estimates.github_issue_id", "=", "github_issues.id")
            .orderBy("issue_estimates.version", "desc")
            .limit(1)
            .as("estimate"),
        (join) => join.onTrue(),
      )
      .select([
        "github_issues.number as number",
        "github_issues.labels as labels",
        "estimate.effort as effort",
      ])
      .where("github_issues.organization_id", "=", organizationId)
      .where("github_issues.id", "=", issueId)
      .executeTakeFirst();

    return row === undefined
      ? undefined
      : { number: row.number, labels: row.labels, effort: row.effort ?? null };
  }
}
