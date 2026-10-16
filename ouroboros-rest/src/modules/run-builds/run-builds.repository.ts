/**
 * The rows a run's build routes read and write (AJ.3, [#265](https://github.com/NobuData/ouroboros/issues/265)).
 *
 * The job itself is written by the farm's one dispatch path (`FarmJobsService.submitForRun`);
 * what this repository owns is the run's side of the linkage — the lock a submission is decided
 * under, the run's repository, the reservation and the `building` status — and the reads that
 * follow a run's build down its retry chain.
 */

import { Injectable } from "@nestjs/common";
import type { Kysely, Transaction } from "kysely";

import { DatabaseService } from "../db/db.service";
import type { BuildJobStatus, Database, Run } from "../db/schema";
import type { RunBuildView } from "./run-builds.resources";

/** The connection or an open transaction. */
export type Writer = Kysely<Database> | Transaction<Database>;

/**
 * The longest retry chain followed. AH.4 retries an infrastructure failure a bounded number of
 * times (`dispatch.policy.ts`); this is a guard against a cycle, never a limit a real chain meets.
 */
const MAX_CHAIN = 32;

@Injectable()
export class RunBuildsRepository {
  /**
   * @param database - The typed connection. Injected, never constructed.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * Run work in one transaction.
   *
   * @param work - The statements.
   * @returns What the work returned.
   */
  transaction<T>(work: (trx: Transaction<Database>) => Promise<T>): Promise<T> {
    return this.database.transaction(work);
  }

  /**
   * A run, locked for the rest of the transaction.
   *
   * @param trx - The transaction.
   * @param runId - The run.
   * @returns The row, or `undefined`.
   */
  lockRun(trx: Transaction<Database>, runId: string): Promise<Run | undefined> {
    return trx
      .selectFrom("runs")
      .selectAll()
      .where("id", "=", runId)
      .forUpdate()
      .executeTakeFirst();
  }

  /**
   * A run, unlocked — what a read answers from.
   *
   * @param runId - The run.
   * @returns The row, or `undefined`.
   */
  findRun(runId: string): Promise<Run | undefined> {
    return this.database.db
      .selectFrom("runs")
      .selectAll()
      .where("id", "=", runId)
      .executeTakeFirst();
  }

  /**
   * A run's repository as the farm names one — `owner/name`.
   *
   * @param writer - The connection or transaction.
   * @param run - The run.
   * @returns The slug, or `undefined` when the workspace no longer holds the repository.
   */
  async repositorySlug(
    writer: Writer,
    run: Pick<Run, "organization_id" | "github_repo_id">,
  ): Promise<string | undefined> {
    const row = await writer
      .selectFrom("github_repos")
      .innerJoin("github_orgs", "github_orgs.id", "github_repos.org_id")
      .select(["github_orgs.login as login", "github_repos.name as name"])
      .where("github_repos.id", "=", run.github_repo_id)
      .where("github_orgs.organization_id", "=", run.organization_id)
      .executeTakeFirst();

    return row === undefined ? undefined : `${row.login}/${row.name}`;
  }

  /**
   * The job a stage attempt already submitted — the submit route's idempotency (V153's
   * `build_jobs_run_stage_key`).
   *
   * @param writer - The open transaction, or `undefined` for the connection.
   * @param run - The run.
   * @param stageKey - The stage.
   * @param attempt - Its attempt.
   * @returns The first job of that attempt, or `undefined`.
   */
  async stageJob(
    writer: Writer | undefined,
    run: Pick<Run, "id" | "organization_id">,
    stageKey: string,
    attempt: number,
  ): Promise<string | undefined> {
    const row = await (writer ?? this.database.db)
      .selectFrom("build_jobs")
      .select("id")
      .where("organization_id", "=", run.organization_id)
      .where("run_id", "=", run.id)
      .where("stage_key", "=", stageKey)
      .where("stage_attempt", "=", attempt)
      .where("retry_of", "is", null)
      .executeTakeFirst();

    return row?.id;
  }

  /**
   * A run's build, followed to the latest attempt of its retry chain.
   *
   * A job is the run's only when `build_jobs.run_id` names it **and** the workspace matches —
   * another run's or another workspace's job is `undefined`, the same as no job at all.
   *
   * @param run - The run.
   * @param jobId - Any attempt of the chain.
   * @returns The latest attempt with its names, or `undefined`.
   */
  async latest(
    run: Pick<Run, "id" | "organization_id">,
    jobId: string,
  ): Promise<RunBuildView | undefined> {
    let current = await this.view(run, jobId);
    let retries = 0;

    while (current !== undefined && current.job.status === "retried" && retries < MAX_CHAIN) {
      const next = await this.database.db
        .selectFrom("build_jobs")
        .select("id")
        .where("organization_id", "=", run.organization_id)
        .where("retry_of", "=", current.job.id)
        .executeTakeFirst();

      if (next === undefined) break;

      retries += 1;
      current = await this.view(run, next.id);
    }

    return current === undefined ? undefined : { ...current, retries };
  }

  /**
   * Point the run's reservation at its build and, if it is `coding`, call it `building` — the
   * dashboard's status, backed by the job from here on.
   *
   * @param trx - The transaction holding the run's lock.
   * @param runId - The run.
   * @param jobId - The build.
   */
  async reserve(trx: Transaction<Database>, runId: string, jobId: string): Promise<void> {
    await trx
      .updateTable("runs")
      .set({ reserved_build_job_id: jobId })
      .where("id", "=", runId)
      .execute();
    await trx
      .updateTable("runs")
      .set({ status: "building" })
      .where("id", "=", runId)
      .where("status", "=", "coding")
      .execute();
  }

  /**
   * A build the run reserved has completed: a retried one hands the reservation to its
   * successor; any other ends the run's `building` — it is `coding` again until the next build.
   *
   * @param organizationId - The job's workspace.
   * @param jobId - The job that completed.
   * @param status - How it completed.
   * @returns Whether a run held it.
   */
  async released(
    organizationId: string,
    jobId: string,
    status: Extract<BuildJobStatus, "succeeded" | "failed" | "retried" | "canceled">,
  ): Promise<boolean> {
    return this.database.transaction(async (trx) => {
      const run = await trx
        .selectFrom("runs")
        .select(["id", "status"])
        .where("organization_id", "=", organizationId)
        .where("reserved_build_job_id", "=", jobId)
        .forUpdate()
        .executeTakeFirst();

      if (run === undefined) return false;

      if (status === "retried") {
        const next = await trx
          .selectFrom("build_jobs")
          .select("id")
          .where("organization_id", "=", organizationId)
          .where("retry_of", "=", jobId)
          .executeTakeFirst();

        if (next !== undefined) {
          await trx
            .updateTable("runs")
            .set({ reserved_build_job_id: next.id })
            .where("id", "=", run.id)
            .execute();
          return true;
        }
      }

      if (run.status === "building") {
        await trx.updateTable("runs").set({ status: "coding" }).where("id", "=", run.id).execute();
      }

      return true;
    });
  }

  /**
   * One job of a run, with the names its resource prints.
   *
   * @param run - The run.
   * @param jobId - The job.
   * @returns The view without its chain count, or `undefined`.
   */
  private async view(
    run: Pick<Run, "id" | "organization_id">,
    jobId: string,
  ): Promise<Omit<RunBuildView, "retries"> | undefined> {
    const row = await this.database.db
      .selectFrom("build_jobs")
      .innerJoin("runner_pools", (join) =>
        join
          .onRef("runner_pools.id", "=", "build_jobs.pool_id")
          .onRef("runner_pools.organization_id", "=", "build_jobs.organization_id"),
      )
      .leftJoin("runners", "runners.id", "build_jobs.runner_id")
      .selectAll("build_jobs")
      .select(["runner_pools.name as poolName", "runners.name as runnerName"])
      .where("build_jobs.organization_id", "=", run.organization_id)
      .where("build_jobs.run_id", "=", run.id)
      .where("build_jobs.id", "=", jobId)
      .executeTakeFirst();

    if (row === undefined) return undefined;

    const { poolName, runnerName, ...job } = row;
    return { job, poolName, runnerName: runnerName ?? null };
  }
}
