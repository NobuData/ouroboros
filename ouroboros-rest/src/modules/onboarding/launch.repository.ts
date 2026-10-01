/**
 * The reads behind the first-run launcher
 * ([#388](https://github.com/NobuData/ouroboros/issues/388), BB.5).
 *
 * ```
 * mirroredPick  the picked issue in the repository's mirrored backlog,   github_issues   (V014)
 *               with the cycle range of its estimate in force           issue_estimates (V026)
 * queueItem     the queue item that speaks for it, if any               queue_items     (V009)
 * latestRun     the newest run of it, if any                            runs            (V008)
 * ```
 *
 * Every statement is held to the workspace and the repository. Nothing here writes: the queue
 * write is `BacklogQueueService`'s (M.3, #112) and the completion stamp is the wizard's.
 */

import { Injectable } from "@nestjs/common";
import { sql } from "kysely";

import { DatabaseService } from "../db/db.service";
import { SCHEMA_NAME, type QueueItem } from "../db/schema";

/** The picked issue as the repository's backlog mirrors it. */
export interface MirroredPickRow {
  /** `github_issues.id` — what the queue write takes. */
  readonly id: string;
  readonly number: number;
  readonly title: string;
  /** The estimate in force's cycle range, in minutes; null for an issue never estimated. */
  readonly cycleMin: number | null;
  readonly cycleMax: number | null;
}

/** A run of the picked issue. */
export interface PickRunRow {
  readonly id: string;
  /** The workflow the run was started under. */
  readonly workflowTag: string;
}

@Injectable()
export class LaunchRepository {
  /**
   * @param database - The typed connection.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * The picked issue in the repository's mirrored backlog, with its latest estimate's cycle
   * range (latest-wins, decision K4).
   *
   * @param organizationId - The workspace.
   * @param repositoryId - `github_repos.id`, already found in that workspace.
   * @param issueNumber - The issue's number.
   * @returns The issue, or `undefined` when the backlog does not mirror it.
   */
  async mirroredPick(
    organizationId: string,
    repositoryId: string,
    issueNumber: number,
  ): Promise<MirroredPickRow | undefined> {
    const { rows } = await sql<{
      id: string;
      number: number;
      title: string;
      cycle_min: number | null;
      cycle_max: number | null;
    }>`
      select i.id, i.number, i.title,
             (e.breakdown->>'cycle_min')::float8 as cycle_min,
             (e.breakdown->>'cycle_max')::float8 as cycle_max
        from ${sql.id(SCHEMA_NAME, "github_issues")} i
        left join lateral (
               select ie.breakdown
                 from ${sql.id(SCHEMA_NAME, "issue_estimates")} ie
                where ie.github_issue_id = i.id
                order by ie.version desc
                limit 1
             ) e on true
       where i.organization_id = ${organizationId}
         and i.github_repo_id = ${repositoryId}
         and i.number = ${issueNumber}
    `.execute(this.database.db);
    const row = rows[0];

    return row === undefined
      ? undefined
      : {
          id: row.id,
          number: row.number,
          title: row.title,
          cycleMin: row.cycle_min,
          cycleMax: row.cycle_max,
        };
  }

  /**
   * The queue item for an issue of the repository.
   *
   * @param organizationId - The workspace.
   * @param repositoryId - `github_repos.id`.
   * @param issueNumber - The issue's number.
   * @returns The item, or `undefined` when the issue is not queued.
   */
  async queueItem(
    organizationId: string,
    repositoryId: string,
    issueNumber: number,
  ): Promise<QueueItem | undefined> {
    return this.database.db
      .selectFrom("queue_items")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("github_repo_id", "=", repositoryId)
      .where("issue_number", "=", issueNumber)
      .executeTakeFirst();
  }

  /**
   * The newest run of an issue of the repository.
   *
   * @param organizationId - The workspace.
   * @param repositoryId - `github_repos.id`.
   * @param issueNumber - The issue's number.
   * @returns The run, or `undefined` when the issue has never run.
   */
  async latestRun(
    organizationId: string,
    repositoryId: string,
    issueNumber: number,
  ): Promise<PickRunRow | undefined> {
    return this.database.db
      .selectFrom("runs")
      .select(["id", "workflow_tag as workflowTag"])
      .where("organization_id", "=", organizationId)
      .where("github_repo_id", "=", repositoryId)
      .where("issue_number", "=", issueNumber)
      .orderBy("started_at", "desc")
      .limit(1)
      .executeTakeFirst();
  }
}
