/**
 * The bisect primitive's rows — `code_bisects` and `code_bisect_steps` (V118, #617).
 *
 * Every write that moves a bisect forward happens inside {@link CodeBisectRepository.locked}, which
 * holds the bisect's row `for update`: a completion event and the resume tick arriving together
 * serialise there, and the second one sees what the first wrote.
 */

import { Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";

import { DatabaseService } from "../../db/db.service";
import type { BuildJobStatus, CodeBisectStatus, Database } from "../../db/schema";

/** A bisect as the service reads it. */
export interface BisectRow {
  readonly id: string;
  readonly organizationId: string;
  readonly investigationId: string | null;
  readonly githubRepoId: string;
  readonly repository: string;
  readonly pool: string;
  readonly testRef: string;
  readonly command: readonly string[] | null;
  readonly goodRef: string;
  readonly badRef: string;
  readonly goodSha: string;
  readonly badSha: string;
  readonly buildRef: string;
  readonly commits: readonly string[];
  readonly lo: number;
  readonly hi: number;
  readonly maxSteps: number;
  readonly status: CodeBisectStatus;
  readonly culpritSha: string | null;
  readonly note: string | null;
  readonly createdAt: Date;
  readonly finishedAt: Date | null;
}

/** One step, with its job's number and status. */
export interface StepRow {
  readonly step: number;
  readonly candidate: number;
  readonly commitSha: string;
  readonly buildJobId: string;
  readonly jobNumber: number;
  readonly jobStatus: BuildJobStatus;
  readonly verdict: "good" | "bad" | null;
  readonly decidedAt: Date | null;
}

/** What a new bisect is. */
export interface NewBisect {
  readonly organizationId: string;
  readonly investigationId: string | null;
  readonly githubRepoId: string;
  readonly repository: string;
  readonly pool: string;
  readonly testRef: string;
  readonly command: readonly string[] | null;
  readonly goodRef: string;
  readonly badRef: string;
  readonly goodSha: string;
  readonly badSha: string;
  readonly buildRef: string;
  readonly commits: readonly string[];
  readonly maxSteps: number;
  readonly createdBy: string | null;
}

/** How a bisect ends. */
export interface BisectEnding {
  readonly status: Exclude<CodeBisectStatus, "running">;
  readonly culpritSha?: string;
  readonly note?: string;
}

type Trx = Transaction<Database>;

@Injectable()
export class CodeBisectRepository {
  /** @param database - The tenancy database. */
  constructor(private readonly database: DatabaseService) {}

  /**
   * Write a bisect, its window the whole line.
   *
   * @param bisect - What it is.
   * @returns Its id.
   */
  async insert(bisect: NewBisect): Promise<string> {
    const row = await this.database.db
      .insertInto("code_bisects")
      .values({
        organization_id: bisect.organizationId,
        investigation_id: bisect.investigationId,
        github_repo_id: bisect.githubRepoId,
        repository: bisect.repository,
        pool: bisect.pool,
        test_ref: bisect.testRef,
        command: bisect.command === null ? null : JSON.stringify(bisect.command),
        good_ref: bisect.goodRef,
        bad_ref: bisect.badRef,
        good_sha: bisect.goodSha,
        bad_sha: bisect.badSha,
        build_ref: bisect.buildRef,
        commits: JSON.stringify(bisect.commits),
        hi: bisect.commits.length - 1,
        max_steps: bisect.maxSteps,
        created_by: bisect.createdBy,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    return row.id;
  }

  /**
   * A bisect this workspace already has for the same question — re-asking does not start another.
   *
   * @param bisect - The question.
   * @returns The newest running or converged one, if any.
   */
  async same(bisect: NewBisect): Promise<BisectRow | undefined> {
    const row = await selectBisects(this.database.db)
      .where("organization_id", "=", bisect.organizationId)
      .where("github_repo_id", "=", bisect.githubRepoId)
      .where("good_sha", "=", bisect.goodSha)
      .where("bad_sha", "=", bisect.badSha)
      .where("test_ref", "=", bisect.testRef)
      .where("pool", "=", bisect.pool)
      .where(
        sql<boolean>`command is not distinct from ${
          bisect.command === null ? null : JSON.stringify(bisect.command)
        }::jsonb`,
      )
      .where("status", "in", ["running", "converged"])
      .orderBy("created_at", "desc")
      .executeTakeFirst();
    return row === undefined ? undefined : bisectOf(row);
  }

  /**
   * One bisect of a workspace.
   *
   * @param organizationId - The workspace.
   * @param id - The bisect.
   * @returns It, or `undefined`.
   */
  async find(organizationId: string, id: string): Promise<BisectRow | undefined> {
    const row = await selectBisects(this.database.db)
      .where("organization_id", "=", organizationId)
      .where("id", "=", id)
      .executeTakeFirst();
    return row === undefined ? undefined : bisectOf(row);
  }

  /**
   * A bisect's steps, with their jobs.
   *
   * @param id - The bisect.
   * @param trx - Inside a transaction, when one is open.
   * @returns The steps, in order.
   */
  async steps(id: string, trx?: Trx): Promise<StepRow[]> {
    const rows = await (trx ?? this.database.db)
      .selectFrom("code_bisect_steps as s")
      .innerJoin("build_jobs as j", (join) =>
        join
          .onRef("j.id", "=", "s.build_job_id")
          .onRef("j.organization_id", "=", "s.organization_id"),
      )
      .select([
        "s.step",
        "s.candidate",
        "s.commit_sha",
        "s.build_job_id",
        "j.number",
        "j.status",
        "s.verdict",
        "s.decided_at",
      ])
      .where("s.bisect_id", "=", id)
      .orderBy("s.step")
      .execute();
    return rows.map((row) => ({
      step: row.step,
      candidate: row.candidate,
      commitSha: row.commit_sha,
      buildJobId: row.build_job_id,
      jobNumber: row.number,
      jobStatus: row.status,
      verdict: row.verdict,
      decidedAt: row.decided_at,
    }));
  }

  /**
   * The running bisects — what the resume tick looks at.
   *
   * @param limit - The most to return, least recently moved first.
   * @returns Their ids and workspaces.
   */
  async running(limit: number): Promise<{ id: string; organizationId: string }[]> {
    const rows = await this.database.db
      .selectFrom("code_bisects")
      .select(["id", "organization_id"])
      .where("status", "=", "running")
      .orderBy("updated_at")
      .limit(limit)
      .execute();
    return rows.map((row) => ({ id: row.id, organizationId: row.organization_id }));
  }

  /**
   * The open step a farm job decides, if any.
   *
   * @param organizationId - The job's workspace.
   * @param jobId - The job.
   * @returns The bisect it belongs to.
   */
  async bisectOfJob(organizationId: string, jobId: string): Promise<string | undefined> {
    const row = await this.database.db
      .selectFrom("code_bisect_steps")
      .select("bisect_id")
      .where("organization_id", "=", organizationId)
      .where("build_job_id", "=", jobId)
      .where("verdict", "is", null)
      .executeTakeFirst();
    return row?.bisect_id;
  }

  /**
   * The automatic retry of a job, when dispatch made one (#252's `retry_of` chain).
   *
   * @param organizationId - The workspace.
   * @param jobId - The retried job.
   * @param trx - Inside a transaction, when one is open.
   * @returns The retry's id, if it exists yet.
   */
  async retryOf(organizationId: string, jobId: string, trx?: Trx): Promise<string | undefined> {
    const row = await (trx ?? this.database.db)
      .selectFrom("build_jobs")
      .select("id")
      .where("organization_id", "=", organizationId)
      .where("retry_of", "=", jobId)
      .orderBy("queued_at", "desc")
      .executeTakeFirst();
    return row?.id;
  }

  /**
   * Run work holding a bisect's row — the one place a bisect moves.
   *
   * @param organizationId - The workspace.
   * @param id - The bisect.
   * @param work - What to do with it, read under the lock.
   * @returns What the work returned; `undefined` when there is no such bisect.
   */
  async locked<T>(
    organizationId: string,
    id: string,
    work: (bisect: BisectRow, trx: Trx) => Promise<T>,
  ): Promise<T | undefined> {
    return this.database.transaction(async (trx) => {
      const row = await selectBisects(trx)
        .where("organization_id", "=", organizationId)
        .where("id", "=", id)
        .forUpdate()
        .executeTakeFirst();
      return row === undefined ? undefined : work(bisectOf(row), trx);
    });
  }

  /**
   * Record a step's job.
   *
   * @param trx - The lock's transaction.
   * @param bisect - The bisect.
   * @param step - Its number.
   * @param candidate - The candidate built.
   * @param jobId - The farm job.
   */
  async addStep(
    trx: Trx,
    bisect: BisectRow,
    step: number,
    candidate: number,
    jobId: string,
  ): Promise<void> {
    await trx
      .insertInto("code_bisect_steps")
      .values({
        bisect_id: bisect.id,
        step,
        candidate,
        commit_sha: bisect.commits[candidate],
        build_job_id: jobId,
        organization_id: bisect.organizationId,
      })
      .execute();
    await this.touch(trx, bisect.id);
  }

  /**
   * Point an open step at its job's automatic retry.
   *
   * @param trx - The lock's transaction.
   * @param bisectId - The bisect.
   * @param step - The step.
   * @param jobId - The retry.
   */
  async followRetry(trx: Trx, bisectId: string, step: number, jobId: string): Promise<void> {
    await trx
      .updateTable("code_bisect_steps")
      .set({ build_job_id: jobId })
      .where("bisect_id", "=", bisectId)
      .where("step", "=", step)
      .execute();
    await this.touch(trx, bisectId);
  }

  /**
   * Decide a step and narrow the checkpoint, together.
   *
   * @param trx - The lock's transaction.
   * @param bisectId - The bisect.
   * @param step - The step.
   * @param verdict - What its job said.
   * @param window - The checkpoint after it.
   * @param at - When.
   */
  async decide(
    trx: Trx,
    bisectId: string,
    step: number,
    verdict: "good" | "bad",
    window: { lo: number; hi: number } | null,
    at: Date,
  ): Promise<void> {
    await trx
      .updateTable("code_bisect_steps")
      .set({ verdict, decided_at: at })
      .where("bisect_id", "=", bisectId)
      .where("step", "=", step)
      .execute();
    if (window !== null) {
      await trx
        .updateTable("code_bisects")
        .set({ lo: window.lo, hi: window.hi, updated_at: at })
        .where("id", "=", bisectId)
        .execute();
    }
  }

  /**
   * End a bisect.
   *
   * @param trx - The lock's transaction.
   * @param bisectId - The bisect.
   * @param ending - How.
   * @param at - When.
   */
  async finish(trx: Trx, bisectId: string, ending: BisectEnding, at: Date): Promise<void> {
    await trx
      .updateTable("code_bisects")
      .set({
        status: ending.status,
        culprit_sha: ending.culpritSha ?? null,
        note: ending.note ?? null,
        finished_at: at,
        updated_at: at,
      })
      .where("id", "=", bisectId)
      .execute();
  }

  private async touch(trx: Trx, bisectId: string): Promise<void> {
    await trx
      .updateTable("code_bisects")
      .set({ updated_at: sql<Date>`now()` })
      .where("id", "=", bisectId)
      .execute();
  }
}

/**
 * The columns a bisect is read with.
 *
 * @param db - The database, or a transaction.
 * @returns The query, to be narrowed.
 */
function selectBisects(db: Trx | DatabaseService["db"]) {
  return db
    .selectFrom("code_bisects")
    .select([
      "id",
      "organization_id",
      "investigation_id",
      "github_repo_id",
      "repository",
      "pool",
      "test_ref",
      "command",
      "good_ref",
      "bad_ref",
      "good_sha",
      "bad_sha",
      "build_ref",
      "commits",
      "lo",
      "hi",
      "max_steps",
      "status",
      "culprit_sha",
      "note",
      "created_at",
      "finished_at",
    ]);
}

type SelectedBisect = Awaited<
  ReturnType<ReturnType<typeof selectBisects>["executeTakeFirstOrThrow"]>
>;

/**
 * A selected row, in the service's names.
 *
 * @param row - The row.
 * @returns The bisect.
 */
function bisectOf(row: SelectedBisect): BisectRow {
  return {
    id: row.id,
    organizationId: row.organization_id,
    investigationId: row.investigation_id,
    githubRepoId: row.github_repo_id,
    repository: row.repository,
    pool: row.pool,
    testRef: row.test_ref,
    command: row.command,
    goodRef: row.good_ref,
    badRef: row.bad_ref,
    goodSha: row.good_sha,
    badSha: row.bad_sha,
    buildRef: row.build_ref,
    commits: row.commits,
    lo: row.lo,
    hi: row.hi,
    maxSteps: row.max_steps,
    status: row.status,
    culpritSha: row.culprit_sha,
    note: row.note,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
  };
}
