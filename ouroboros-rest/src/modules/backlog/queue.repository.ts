/**
 * Every statement `POST /api/v1/backlog/queue` issues — three, all scoped to one workspace
 * (M.3, [#112](https://github.com/NobuData/ouroboros/issues/112)).
 *
 * ```
 * selection()      the issues named, each with the estimate in force   — one read
 * queuedNumbers()  which of those numbers the queue already holds      — one read
 * append()         max(position), then the inserts, in one transaction — the write
 * ```
 *
 * ## Org scoping is not optional and is not the client's
 *
 * Every method takes `organizationId` first and every statement filters on it, exactly as
 * `listing.repository.ts` and `queue/queue.repository.ts` do. The value comes from the tenant
 * context, never from the request, and `queue.repository.spec.ts` asserts the predicate is
 * present in every compiled statement — because the failure it guards against is silent: an id
 * belonging to another workspace would otherwise be *found*, and the ticket's *cross-org ids →
 * 404* criterion is exactly this `where` rather than a comparison somebody remembered to make.
 *
 * ## The write is one transaction, and it is all-or-nothing
 *
 * The ticket chose all-or-nothing deliberately and says so in the OpenAPI description: a
 * partly-applied bulk queue is far worse to reason about than a rejected one. {@link append} is
 * therefore a single transaction over every row — one `max(position)` and one multi-row insert
 * — so a failure at the fourth row leaves the first three unwritten and the person who pressed
 * *Queue 3 selected* is never left guessing which of the three took.
 *
 * ## Two collisions, and only one of them is worth retrying
 *
 * V009 gives `queue_items` two unique keys and they fail differently on purpose.
 *
 *   * `queue_items_organization_position_key` is **deferrable**, so a duplicate position is
 *     raised at `commit` rather than at the statement. It means another append computed the
 *     same `max(position)` in the window between this transaction's read and its commit — a
 *     race, not a mistake, and one that succeeds on the next attempt because the position it
 *     reads will have moved. {@link append} retries it, exactly as `estimation.repository.ts`
 *     retries a version collision and for the same reason.
 *   * `queue_items_organization_issue_key` is **immediate**, so a duplicate enqueue is raised
 *     at the insert. It means the issue is already queued, which is a thing a person can ask
 *     for twice and should be told about — retrying it would fail identically forever. It is
 *     re-thrown untouched for `queue.service.ts` to turn into the per-issue `409`.
 */

import { Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";

import { DatabaseService } from "../db/db.service";
import type { Database, EstimateEffort, NewQueueItem, QueueItem, SizingStatus } from "../db/schema";
import { UNIQUE_VIOLATION, isDatabaseFailure } from "../tenancy/constraints";

/** V009's two unique keys, by the names the migration gives them. */
const POSITION_CONSTRAINT = "queue_items_organization_position_key";
const ISSUE_NUMBER_CONSTRAINT = "queue_items_organization_issue_key";

/**
 * How many times an append may lose the race for a position before it gives up.
 *
 * `estimation.repository.ts`' constant, for its reason: each retry re-reads a number that has
 * since moved, so the second attempt succeeds unless a third writer arrived in the same
 * millisecond. A bound rather than a loop, because a bug that made every attempt collide would
 * otherwise spin instead of failing.
 */
const MAX_POSITION_ATTEMPTS = 3;

/** One issue named by the request, with everything a queue row is written from. */
export interface QueueCandidate {
  /** `github_issues.id` — the id the request sent, and what an error echoes back. */
  readonly id: string;
  /** GitHub's number. The queue's natural key within a workspace. */
  readonly number: number;
  /** The title as GitHub currently has it — copied into the queue row, not referenced. */
  readonly title: string;
  /** Which repository it lives in. `queue_items` names it, and V009's trigger checks it. */
  readonly githubRepoId: string;
  /** Where the issue is in the sizing pipeline. Only `sized` may be queued. */
  readonly sizingStatus: SizingStatus;
  /** The effort of the estimate in force, or `null` for an issue carrying no estimate. */
  readonly effort: EstimateEffort | null;
  /** The workflow that estimate suggested — the default when the request names none. */
  readonly suggestedWorkflow: string | null;
  /** `breakdown.est_minutes` from that estimate, the number the queue row copies. */
  readonly estMinutes: number | null;
}

/** One row to append, as the service decided it. */
export interface QueueAppendRow {
  readonly githubRepoId: string;
  readonly issueNumber: number;
  readonly issueTitle: string;
  readonly effort: NewQueueItem["effort"];
  readonly workflowTag: string;
  /** The minutes to store, or `null` — reconciled by `queue.resources.ts`, never invented here. */
  readonly estMinutes: number | null;
}

@Injectable()
export class BacklogQueueRepository {
  /**
   * @param database - The typed connection. Injected, never constructed: the pool's lifecycle
   *   belongs to `DatabaseService`.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * The issues these ids name in this workspace, each with the estimate in force.
   *
   * **The estimate is a lateral, for `listing.repository.ts`' reason**: decision **K4** makes
   * re-estimation a new row and the highest version wins, so a plain join would multiply a
   * twice-estimated issue into two candidates. `left` rather than `inner`, because an issue
   * with no estimate is one this request has to *name in a 422* rather than one it may silently
   * drop — the two are indistinguishable to a client, and only one of them is honest.
   *
   * **Fewer rows than ids is the answer, not an error.** An id naming nothing in this workspace
   * — including one naming an issue in another — simply matches nothing, and
   * `queue.service.ts` is what turns the difference into the `404`.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param issueIds - `github_issues.id`, already validated as uuids by the pipe.
   * @returns One row per id that matched, in no particular order — the service reorders them
   *   into the caller's own, which is the order positions are handed out in.
   */
  async selection(organizationId: string, issueIds: readonly string[]): Promise<QueueCandidate[]> {
    return this.database.db
      .selectFrom("github_issues")
      .leftJoinLateral(
        (eb) =>
          eb
            .selectFrom("issue_estimates")
            .select([
              "issue_estimates.effort as effort",
              "issue_estimates.suggested_workflow as suggestedWorkflow",
              // Read out of the document in the statement rather than shipping the whole
              // breakdown to read one key off it. `->>` is text and the cast is what makes it
              // the integer the column takes; V026's closed grammar guarantees the key exists.
              sql<number>`(${sql.ref("issue_estimates.breakdown")}->>'est_minutes')::int`.as(
                "estMinutes",
              ),
            ])
            .whereRef("issue_estimates.github_issue_id", "=", "github_issues.id")
            .orderBy("issue_estimates.version", "desc")
            .limit(1)
            .as("estimate"),
        (join) => join.onTrue(),
      )
      .select([
        "github_issues.id as id",
        "github_issues.number as number",
        "github_issues.title as title",
        "github_issues.github_repo_id as githubRepoId",
        "github_issues.sizing_status as sizingStatus",
        "estimate.effort as effort",
        "estimate.suggestedWorkflow as suggestedWorkflow",
        "estimate.estMinutes as estMinutes",
      ])
      .where("github_issues.organization_id", "=", organizationId)
      .where("github_issues.id", "in", [...issueIds])
      .execute();
  }

  /**
   * Which of these issue numbers this workspace's queue already holds.
   *
   * The read behind the per-issue `409`. It is `queue_items_organization_issue_key`'s own
   * question asked in advance — *not* a substitute for the key, which is what actually enforces
   * it: `constraints.ts` makes the argument, that a service which asks and then inserts has a
   * window between the two and the loser of that race gets a `500` with PostgreSQL's own text
   * in it. This read is what makes the ordinary answer per-issue; the key is what makes it true.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param numbers - The GitHub numbers of the selection.
   * @returns The subset already in the queue. Empty when none are.
   */
  async queuedNumbers(organizationId: string, numbers: readonly number[]): Promise<number[]> {
    const rows = await this.database.db
      .selectFrom("queue_items")
      .select("issue_number")
      .where("organization_id", "=", organizationId)
      .where("issue_number", "in", [...numbers])
      .execute();

    return rows.map((row) => row.issue_number);
  }

  /**
   * Append every row to the end of this workspace's queue, in one transaction.
   *
   * @param organizationId - The workspace, from the tenant context. Written onto every row;
   *   never taken from the request.
   * @param rows - What to append, in the order the caller selected them. Positions are handed
   *   out down this list, so the queue reads the way the person built the selection.
   * @returns The inserted rows, in queue order.
   * @throws Whatever the database refused. A duplicate issue number reaches the caller
   *   untouched — see this file's header, and `queue.service.ts` for what it becomes.
   */
  async append(organizationId: string, rows: readonly QueueAppendRow[]): Promise<QueueItem[]> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.database.transaction(async (trx) => {
          const from = await this.nextPosition(trx, organizationId);

          return trx
            .insertInto("queue_items")
            .values(
              rows.map((row, index) => ({
                organization_id: organizationId,
                github_repo_id: row.githubRepoId,
                issue_number: row.issueNumber,
                issue_title: row.issueTitle,
                effort: row.effort,
                workflow_tag: row.workflowTag,
                position: from + index,
                est_minutes: row.estMinutes,
              })),
            )
            .returningAll()
            .execute();
        });
      } catch (error) {
        if (attempt >= MAX_POSITION_ATTEMPTS || !isPositionCollision(error)) {
          throw error;
        }
      }
    }
  }

  /**
   * The position the next appended row takes.
   *
   * **Read inside the transaction**, for `estimation.repository.ts`' reason about a version: a
   * number read outside it would be a number that was true a moment ago. Even inside, two
   * appends can read the same one — nothing locks the gap above the last row — which is what
   * {@link append}'s retry is for and why V009 made that key deferrable.
   *
   * @param trx - The write's transaction.
   * @param organizationId - The workspace.
   * @returns `max(position) + 1`, or `1` for a queue with nothing in it. Density is V009's
   *   *writer's convention* and this is the writer keeping it: appending to a queue numbered
   *   1, 2, 3 gives 4.
   */
  private async nextPosition(trx: Transaction<Database>, organizationId: string): Promise<number> {
    const row = await trx
      .selectFrom("queue_items")
      .select(({ fn }) => fn.max<number>("position").as("last"))
      .where("organization_id", "=", organizationId)
      .executeTakeFirst();

    // `max()` over no rows is one row holding null rather than an empty result, so both
    // fallbacks are reachable: the empty queue, and a workspace whose rows were all removed.
    return (row?.last ?? 0) + 1;
  }
}

/**
 * Did another append take these positions first?
 *
 * @param error - Whatever the transaction rejected with.
 * @returns `true` only for a unique violation on the position key. Narrow on purpose: a
 *   duplicate *issue number* is the caller's request rather than a race and would fail
 *   identically on every attempt, and a check violation is a row V009 forbids — retrying either
 *   would turn a clear failure into a slow one.
 */
export function isPositionCollision(error: unknown): boolean {
  return (
    isDatabaseFailure(error) &&
    error.code === UNIQUE_VIOLATION &&
    error.constraint === POSITION_CONSTRAINT
  );
}

/**
 * Was this the queue refusing an issue it already holds?
 *
 * @param error - Whatever the write rejected with.
 * @returns `true` only for a unique violation on `queue_items_organization_issue_key` — the
 *   race `queue.service.ts`'s own check cannot close, answered there as the same `409` the
 *   check would have produced.
 */
export function isQueuedTwice(error: unknown): boolean {
  return (
    isDatabaseFailure(error) &&
    error.code === UNIQUE_VIOLATION &&
    error.constraint === ISSUE_NUMBER_CONSTRAINT
  );
}
