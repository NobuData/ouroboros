/**
 * Every statement build dispatch issues, in one class.
 *
 * AH.4 ([#252](https://github.com/NobuData/ouroboros/issues/252)). `gateway.repository.ts` keeps
 * runners live and records what agents report; this one moves jobs through the lifecycle in
 * `job.states.ts` — submitted, offered, accepted, taken back, retried, cancelled — and answers the
 * two questions the rest of the farm asks of the queue: *which runners could take this job?* and
 * *how deep is this runner's queue?*
 *
 * ---------------------------------------------------------------------------
 * **A job moves only from the state it was read in.** Every single-row move locks the row, reads
 * its phase, holds the move to `assertTransition`, and writes with a `where` on the status it
 * read — so a race loses to the lock and a bug loses to the table. The two bulk statements (an
 * unanswered offer taken back, and the housekeeping reads) name their one legal move in the
 * `where` and assert it once.
 *
 * **Capacity is decided under the runner's row lock.** Two placements can each read a runner
 * holding one job of a two-job cap; only one of them may put the second there. {@link place}
 * locks the runner, counts what it holds *after* the lock, and only then offers — so queue depths
 * stay exact under concurrent submission, which is the issue's acceptance criterion. The job
 * itself is taken with `skip locked`, so two dispatchers never fight over one job: the second
 * simply finds it gone.
 *
 * **Tenancy is carried, never inferred.** Every statement that acts on a job names the job's
 * workspace, and a runner is only ever looked up in the job's workspace — V040's composite keys
 * make a job on another workspace's runner a row PostgreSQL refuses, and these `where`s make it
 * one this service never asks for. The housekeeping reads ({@link waiting}, {@link reclaimOffers},
 * {@link lostJobs}) are unscoped for the presence sweep's reason: they are the fleet's own
 * upkeep, and each row they return is then acted on in its own workspace.
 */

import { Injectable } from "@nestjs/common";
import { sql, type RawBuilder, type Transaction } from "kysely";

import { DatabaseService } from "../../db/db.service";
import type { BuildExecutor, BuildJob, Database, NewBuildJob, RunnerPool } from "../../db/schema";
import {
  allocateNumber,
  attemptOf,
  infrastructureOutcome,
  insertRetryAttempt,
} from "./job.lifecycle";
import {
  HELD_PHASES,
  assertTransition,
  isTerminal,
  phaseOf,
  statusOf,
  type JobPhase,
} from "./job.states";

/** The statuses a runner holds a job in — offered, accepted (`queued` with a runner), running. */
const HELD_STATUSES = ["offered", "queued", "running"] as const;

/** The runner statuses that can take new work: live, and not an operator's drain. */
const TAKING_WORK = ["online", "building"] as const;

/** A waiting job, as the dispatcher's pass reads it. */
export interface WaitingJob {
  readonly id: string;
  readonly organization_id: string;
  readonly pool_id: string;
  readonly executor: BuildExecutor;
  /** Read so a record that cannot be offered is noticed before it is placed (`offer.ts`). */
  readonly command: string;
  readonly commit_sha: string | null;
}

/** A runner that could take a job, and how full it is. */
export interface Candidate {
  readonly id: string;
  readonly name: string;
  /** Jobs it holds now: offered, accepted and running. */
  readonly held: number;
  /** Its home pool's `max_concurrency` — the cap its agent enforces through `ack.pool`. */
  readonly max_concurrency: number;
}

/** A job just offered, with what the offer needs to say. */
export interface PlacedJob {
  readonly job: BuildJob;
  readonly poolName: string;
  /** The repository's GitHub owner, lower-cased as V003 stores it. */
  readonly repoOwner: string;
  readonly repoName: string;
  /** Which attempt of its build this is — 2 for an automatic retry. */
  readonly attempt: number;
}

/** What {@link DispatchRepository.place} did. */
export type Placement =
  | { readonly kind: "placed"; readonly placed: PlacedJob }
  /** The job is no longer waiting — another dispatcher took it, or it was cancelled. */
  | { readonly kind: "job_unavailable" }
  /** The runner cannot take it now: full, drained, gone, or unable to run its executor. */
  | { readonly kind: "runner_unavailable" };

/** What {@link DispatchRepository.cancel} did. */
export type Cancellation =
  | { readonly kind: "not_found" }
  | { readonly kind: "terminal"; readonly job: BuildJob }
  | { readonly kind: "canceled"; readonly job: BuildJob; readonly heldBy: string | null };

/** A job taken back from a lost runner, and what became of it. */
export interface Requeued {
  readonly organizationId: string;
  readonly jobId: string;
  readonly runnerId: string;
  readonly from: JobPhase;
  /** `waiting` when nothing had run; `retried` or `failed` when it had. */
  readonly to: "waiting" | "retried" | "failed";
  /** The new attempt, when it was retried. */
  readonly retryId?: string;
}

/** An offer taken back because nobody answered it. */
export interface Reclaimed {
  readonly id: string;
  readonly organization_id: string;
  readonly runner_id: string | null;
}

/**
 * What a runner reporting a job should be told about it.
 *
 *   * `unknown` — no job of this workspace has that id. Nothing to say.
 *   * `live` — it is this runner's: offered, accepted or running here.
 *   * `finished_here` — it ended, and it was this runner's own `job.finish` that ended it; a
 *     report after that is a heartbeat that crossed the finish.
 *   * `canceled` — an operator cancelled it.
 *   * `elsewhere` — it is somebody else's now, or it was taken back from this runner and
 *     retried: the runner is holding work nobody counts as its own.
 */
export type Liveness = "unknown" | "live" | "finished_here" | "canceled" | "elsewhere";

/** A job with the names a resource prints. */
export interface JobView {
  readonly job: BuildJob;
  readonly poolName: string;
  readonly repoOwner: string;
  readonly repoName: string;
}

/** What a submission writes, before its number is allocated. */
export type JobSubmission = Omit<NewBuildJob, "id" | "number" | "status" | "runner_id">;

@Injectable()
export class DispatchRepository {
  /**
   * @param database - The typed connection. Injected, never constructed.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * A workspace's pool, by the name a submission uses.
   *
   * @param organizationId - The workspace.
   * @param name - The pool's name.
   * @returns The pool, or `undefined`.
   */
  async pool(organizationId: string, name: string): Promise<RunnerPool | undefined> {
    return this.database.db
      .selectFrom("runner_pools")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("name", "=", name)
      .executeTakeFirst();
  }

  /**
   * A repository of the workspace's GitHub mirror, by `owner/name`.
   *
   * @param organizationId - The workspace.
   * @param owner - The GitHub owner, lower-cased.
   * @param name - The repository name, lower-cased.
   * @returns Its id, or `undefined` when the workspace mirrors no such repository.
   */
  async repository(
    organizationId: string,
    owner: string,
    name: string,
  ): Promise<string | undefined> {
    const row = await this.database.db
      .selectFrom("github_repos")
      .innerJoin("github_orgs", "github_orgs.id", "github_repos.org_id")
      .select("github_repos.id")
      .where("github_orgs.organization_id", "=", organizationId)
      .where("github_orgs.login", "=", owner)
      .where("github_repos.name", "=", name)
      .executeTakeFirst();

    return row?.id;
  }

  /**
   * Put a new job in its pool's queue, numbered.
   *
   * @param submission - Everything but the number.
   * @returns The job, `queued` and held by nobody.
   */
  async submit(submission: JobSubmission): Promise<BuildJob> {
    return this.database.transaction(async (trx) => {
      const number = await allocateNumber(trx, submission.organization_id);

      return trx
        .insertInto("build_jobs")
        .values({ ...submission, number, status: "queued", runner_id: null })
        .returningAll()
        .executeTakeFirstOrThrow();
    });
  }

  /**
   * The oldest waiting jobs, across every workspace — the dispatcher's pass.
   *
   * @param limit - How many.
   * @returns The jobs, oldest first.
   */
  async waiting(limit: number): Promise<WaitingJob[]> {
    return this.database.db
      .selectFrom("build_jobs")
      .select(["id", "organization_id", "pool_id", "executor", "command", "commit_sha"])
      .where("status", "=", "queued")
      .where("runner_id", "is", null)
      .orderBy("queued_at")
      .orderBy("number")
      .limit(limit)
      .execute();
  }

  /**
   * Every runner that could take a job now, least loaded first.
   *
   * The eligibility the issue tabulates, in one statement: the job's workspace; the job's pool —
   * the runner's own, or one an enabled `runner_pool_windows` row joins it to at this instant
   * (V040 leaves that resolution to dispatch, and a union is what makes two overlapping windows
   * harmless); `desired_state = 'active'`, so a drain is honoured whatever the pill says; a live
   * status; the job's executor among the ones its `hello` reported, so a container job is never
   * offered to a machine without docker; and room under its cap. Whether it is connected *to this
   * process* is the dispatcher's to ask, of the session registry.
   *
   * @param job - The job.
   * @param at - Now, for the pool windows.
   * @returns The candidates, fewest held jobs first, then by name.
   */
  async candidates(job: WaitingJob, at: Date): Promise<Candidate[]> {
    const { rows } = await sql<Candidate>`
      select c.id, c.name, c.held, c.max_concurrency
        from (select r.id, r.name, p.max_concurrency,
                     (select count(*)::integer
                        from ouroboros.build_jobs j
                       where j.organization_id = r.organization_id
                         and j.runner_id = r.id
                         and j.status in ('offered', 'queued', 'running')) as held
                from ouroboros.runners r
                join ouroboros.runner_pools p
                  on p.id = r.pool_id and p.organization_id = r.organization_id
               where r.organization_id = ${job.organization_id}
                 and r.desired_state = 'active'
                 and r.status in ('online', 'building')
                 and (r.capabilities -> 'executors') @> jsonb_build_array(${job.executor}::text)
                 and (r.pool_id = ${job.pool_id}
                      or exists (
                        select 1
                          from ouroboros.runner_pool_windows w
                         where w.organization_id = r.organization_id
                           and w.runner_id = r.id
                           and w.pool_id = ${job.pool_id}
                           and w.enabled
                           and w.days_of_week @> to_jsonb(
                                 extract(isodow from ${at}::timestamptz at time zone 'UTC')::integer)
                           and (${at}::timestamptz at time zone 'UTC')::time >= w.starts_at
                           and (${at}::timestamptz at time zone 'UTC')::time < w.ends_at))) c
       where c.held < c.max_concurrency
       order by c.held, c.name`.execute(this.database.db);

    return rows;
  }

  /**
   * Offer a waiting job to a runner — if both are still what the dispatcher read.
   *
   * @param job - The job.
   * @param runnerId - The runner chosen for it.
   * @param at - Now: the offer's `offered_at`.
   * @returns What happened.
   */
  async place(job: WaitingJob, runnerId: string, at: Date): Promise<Placement> {
    return this.database.transaction(async (trx): Promise<Placement> => {
      const row = await trx
        .selectFrom("build_jobs")
        .selectAll()
        .where("organization_id", "=", job.organization_id)
        .where("id", "=", job.id)
        .where("status", "=", "queued")
        .where("runner_id", "is", null)
        .forUpdate()
        .skipLocked()
        .executeTakeFirst();

      if (!row) return { kind: "job_unavailable" };

      // The runner, locked: every placement onto it waits here, so the count below is the
      // count this offer is added to.
      const runner = await trx
        .selectFrom("runners")
        .innerJoin("runner_pools", (join) =>
          join
            .onRef("runner_pools.id", "=", "runners.pool_id")
            .onRef("runner_pools.organization_id", "=", "runners.organization_id"),
        )
        .select(["runners.id", "runner_pools.max_concurrency"])
        .where("runners.organization_id", "=", job.organization_id)
        .where("runners.id", "=", runnerId)
        .where("runners.desired_state", "=", "active")
        .where("runners.status", "in", TAKING_WORK)
        .where(
          sql<boolean>`(runners.capabilities -> 'executors') @> jsonb_build_array(${row.executor}::text)`,
        )
        .forUpdate("runners")
        .executeTakeFirst();

      if (!runner) return { kind: "runner_unavailable" };
      if ((await this.held(trx, job.organization_id, runnerId)) >= runner.max_concurrency) {
        return { kind: "runner_unavailable" };
      }

      assertTransition(phaseOf(row), "offered", row.id);

      const offered = await trx
        .updateTable("build_jobs")
        .set({
          status: "offered",
          runner_id: runnerId,
          offered_at: sql<Date>`greatest(${at}::timestamptz, queued_at)`,
        })
        .where("organization_id", "=", job.organization_id)
        .where("id", "=", row.id)
        .where("status", "=", "queued")
        .where("runner_id", "is", null)
        .returningAll()
        .executeTakeFirstOrThrow();

      const names = await trx
        .selectFrom("runner_pools")
        .innerJoin("github_repos", (join) =>
          join.on("github_repos.id", "=", offered.github_repo_id),
        )
        .innerJoin("github_orgs", "github_orgs.id", "github_repos.org_id")
        .select([
          "runner_pools.name as poolName",
          "github_orgs.login as repoOwner",
          "github_repos.name as repoName",
        ])
        .where("runner_pools.organization_id", "=", job.organization_id)
        .where("runner_pools.id", "=", offered.pool_id)
        .executeTakeFirstOrThrow();

      return {
        kind: "placed",
        placed: {
          job: offered,
          ...names,
          attempt: await attemptOf(trx, job.organization_id, offered.id),
        },
      };
    });
  }

  /**
   * Put an offered job back in its pool's queue — it was declined, or it could not be sent.
   *
   * @param organizationId - The workspace.
   * @param runnerId - The runner it was offered to.
   * @param jobId - The job.
   * @returns Whether it was still offered to that runner.
   */
  async release(organizationId: string, runnerId: string, jobId: string): Promise<boolean> {
    return this.move(organizationId, runnerId, jobId, "offered", "waiting");
  }

  /**
   * Record an agent's `job.accept`: the job is this runner's, waiting behind whatever it runs.
   *
   * @param organizationId - The workspace.
   * @param runnerId - The runner that accepted it.
   * @param jobId - The job.
   * @returns Whether it was offered to that runner — false for a stale or unknown accept.
   */
  async accept(organizationId: string, runnerId: string, jobId: string): Promise<boolean> {
    return this.move(organizationId, runnerId, jobId, "offered", "accepted");
  }

  /**
   * Take back every offer nobody answered in time.
   *
   * @param cutoff - Offers made before this are taken back.
   * @returns The jobs, now waiting again.
   */
  async reclaimOffers(cutoff: Date): Promise<Reclaimed[]> {
    assertTransition("offered", "waiting");

    return this.database.transaction(async (trx) => {
      const stale = await trx
        .selectFrom("build_jobs")
        .select(["id", "organization_id", "runner_id"])
        .where("status", "=", "offered")
        .where("offered_at", "<", cutoff)
        .forUpdate()
        .skipLocked()
        .execute();

      if (stale.length === 0) return [];

      await trx
        .updateTable("build_jobs")
        .set({ status: "queued", runner_id: null, offered_at: null })
        .where(
          "id",
          "in",
          stale.map((row) => row.id),
        )
        .where("status", "=", "offered")
        .execute();

      return stale;
    });
  }

  /**
   * Jobs held by runners that are gone: offline or removed, and silent for longer than the
   * resume window — or removed outright, which no window brings back.
   *
   * @param cutoff - Runners last seen before this are lost.
   * @param limit - How many jobs.
   * @returns The jobs, oldest first.
   */
  async lostJobs(cutoff: Date, limit: number): Promise<{ id: string; organization_id: string }[]> {
    return this.database.db
      .selectFrom("build_jobs")
      .innerJoin("runners", (join) =>
        join
          .onRef("runners.id", "=", "build_jobs.runner_id")
          .onRef("runners.organization_id", "=", "build_jobs.organization_id"),
      )
      .select(["build_jobs.id", "build_jobs.organization_id"])
      .where("build_jobs.status", "in", HELD_STATUSES)
      .where(lostRunner(cutoff))
      .orderBy("build_jobs.queued_at")
      .limit(limit)
      .execute();
  }

  /**
   * Take one job back from a lost runner.
   *
   * Nothing had run if it was offered or accepted, so it simply waits again. A running job is an
   * infrastructure failure — *runners die mid-build* — and goes through the retry policy:
   * `retried` with a new attempt while the automatic retries last, `failed` for good after.
   *
   * @param organizationId - The workspace.
   * @param jobId - The job.
   * @param cutoff - The same cutoff {@link lostJobs} used; re-checked under the lock, so a
   *   runner that came back in between keeps its work.
   * @param at - Now.
   * @returns What became of it, or `undefined` when it is no longer a lost runner's.
   */
  async requeueLost(
    organizationId: string,
    jobId: string,
    cutoff: Date,
    at: Date,
  ): Promise<Requeued | undefined> {
    return this.database.transaction(async (trx): Promise<Requeued | undefined> => {
      const row = await trx
        .selectFrom("build_jobs")
        .innerJoin("runners", (join) =>
          join
            .onRef("runners.id", "=", "build_jobs.runner_id")
            .onRef("runners.organization_id", "=", "build_jobs.organization_id"),
        )
        .selectAll("build_jobs")
        .where("build_jobs.organization_id", "=", organizationId)
        .where("build_jobs.id", "=", jobId)
        .where("build_jobs.status", "in", HELD_STATUSES)
        .where(lostRunner(cutoff))
        .forUpdate("build_jobs")
        .skipLocked()
        .executeTakeFirst();

      if (!row?.runner_id) return undefined;

      const from = phaseOf(row);
      const runnerId = row.runner_id;

      if (from !== "running") {
        assertTransition(from, "waiting", row.id);
        await trx
          .updateTable("build_jobs")
          .set({ status: "queued", runner_id: null, offered_at: null })
          .where("organization_id", "=", organizationId)
          .where("id", "=", row.id)
          .where("status", "=", row.status)
          .execute();

        return { organizationId, jobId: row.id, runnerId, from, to: "waiting" };
      }

      const to = infrastructureOutcome(await attemptOf(trx, organizationId, row.id));
      assertTransition(from, to, row.id);

      await trx
        .updateTable("build_jobs")
        .set({
          status: to,
          exit_code: null,
          finished_at: sql<Date>`greatest(${at}::timestamptz, started_at)`,
        })
        .where("organization_id", "=", organizationId)
        .where("id", "=", row.id)
        .where("status", "=", "running")
        .execute();

      const retry = to === "retried" ? await insertRetryAttempt(trx, row, at) : undefined;

      return { organizationId, jobId: row.id, runnerId, from, to, retryId: retry?.id };
    });
  }

  /**
   * Cancel a job — an operator's decision, and final.
   *
   * @param organizationId - The workspace, from the session.
   * @param jobId - The job.
   * @param at - Now: its `finished_at`.
   * @returns What happened: not this workspace's, already over, or cancelled — with the runner
   *   that held it, so the cancel can be propagated.
   */
  async cancel(organizationId: string, jobId: string, at: Date): Promise<Cancellation> {
    return this.database.transaction(async (trx): Promise<Cancellation> => {
      const row = await trx
        .selectFrom("build_jobs")
        .selectAll()
        .where("organization_id", "=", organizationId)
        .where("id", "=", jobId)
        .forUpdate()
        .executeTakeFirst();

      if (!row) return { kind: "not_found" };

      const from = phaseOf(row);
      if (isTerminal(from)) return { kind: "terminal", job: row };

      assertTransition(from, "canceled", row.id);

      const canceled = await trx
        .updateTable("build_jobs")
        .set({
          status: "canceled",
          finished_at: sql<Date>`greatest(${at}::timestamptz, coalesce(started_at, offered_at, queued_at))`,
        })
        .where("organization_id", "=", organizationId)
        .where("id", "=", row.id)
        .where("status", "=", statusOf(from))
        .returningAll()
        .executeTakeFirstOrThrow();

      return {
        kind: "canceled",
        job: canceled,
        heldBy: HELD_PHASES.includes(from) ? row.runner_id : null,
      };
    });
  }

  /**
   * What a runner reporting a job should be told about it — see {@link Liveness}.
   *
   * @param organizationId - The workspace, from the connection's identity.
   * @param runnerId - The runner reporting it.
   * @param jobId - The job it named.
   * @returns The answer.
   */
  async liveness(organizationId: string, runnerId: string, jobId: string): Promise<Liveness> {
    const row = await this.database.db
      .selectFrom("build_jobs")
      .select(["status", "runner_id"])
      .where("organization_id", "=", organizationId)
      .where("id", "=", jobId)
      .executeTakeFirst();

    if (!row) return "unknown";

    const phase = phaseOf(row);
    const here = row.runner_id === runnerId;

    if (here && HELD_PHASES.includes(phase)) return "live";

    if (here && isTerminal(phase)) {
      const own = await this.database.db
        .selectFrom("runner_terminal_frames")
        .select("frame_id")
        .where("organization_id", "=", organizationId)
        .where("runner_id", "=", runnerId)
        .where("job_id", "=", jobId)
        .where("applied", "=", true)
        .executeTakeFirst();

      if (own) return "finished_here";
    }

    return phase === "canceled" ? "canceled" : "elsewhere";
  }

  /**
   * A runner's queue depth — the jobs it has **accepted and not started**, which is the agent's
   * own definition of `heartbeat.queue_depth` and the runners table's `q:N`. An outstanding
   * offer is not in it, and neither is the running job.
   *
   * @param organizationId - The workspace.
   * @param runnerId - The runner.
   * @returns The depth.
   */
  async queueDepth(organizationId: string, runnerId: string): Promise<number> {
    const row = await this.database.db
      .selectFrom("build_jobs")
      .select(({ fn }) => fn.countAll<string>().as("depth"))
      .where("organization_id", "=", organizationId)
      .where("runner_id", "=", runnerId)
      .where("status", "=", "queued")
      .executeTakeFirstOrThrow();

    return Number(row.depth);
  }

  /**
   * A job, with the names its resource prints.
   *
   * @param organizationId - The workspace.
   * @param jobId - The job.
   * @returns The view, or `undefined`.
   */
  async view(organizationId: string, jobId: string): Promise<JobView | undefined> {
    const row = await this.database.db
      .selectFrom("build_jobs")
      .innerJoin("runner_pools", (join) =>
        join
          .onRef("runner_pools.id", "=", "build_jobs.pool_id")
          .onRef("runner_pools.organization_id", "=", "build_jobs.organization_id"),
      )
      .innerJoin("github_repos", "github_repos.id", "build_jobs.github_repo_id")
      .innerJoin("github_orgs", "github_orgs.id", "github_repos.org_id")
      .selectAll("build_jobs")
      .select([
        "runner_pools.name as poolName",
        "github_orgs.login as repoOwner",
        "github_repos.name as repoName",
      ])
      .where("build_jobs.organization_id", "=", organizationId)
      .where("build_jobs.id", "=", jobId)
      .executeTakeFirst();

    if (!row) return undefined;

    const { poolName, repoOwner, repoName, ...job } = row;
    return { job, poolName, repoOwner, repoName };
  }

  /**
   * How many jobs a runner holds, counted inside the placement's transaction.
   *
   * @param trx - The transaction holding the runner's lock.
   * @param organizationId - The workspace.
   * @param runnerId - The runner.
   * @returns Offered, accepted and running jobs on it.
   */
  private async held(
    trx: Transaction<Database>,
    organizationId: string,
    runnerId: string,
  ): Promise<number> {
    const row = await trx
      .selectFrom("build_jobs")
      .select(({ fn }) => fn.countAll<string>().as("held"))
      .where("organization_id", "=", organizationId)
      .where("runner_id", "=", runnerId)
      .where("status", "in", HELD_STATUSES)
      .executeTakeFirstOrThrow();

    return Number(row.held);
  }

  /**
   * One job, moved from one runner-held phase to another — the single-row move behind
   * {@link release} and {@link accept}.
   *
   * @param organizationId - The workspace.
   * @param runnerId - The runner it must be held by.
   * @param jobId - The job.
   * @param from - The phase it must be in.
   * @param to - The phase to move it to.
   * @returns Whether it moved.
   */
  private async move(
    organizationId: string,
    runnerId: string,
    jobId: string,
    from: "offered",
    to: "waiting" | "accepted",
  ): Promise<boolean> {
    assertTransition(from, to, jobId);

    const result = await this.database.db
      .updateTable("build_jobs")
      .set(
        to === "waiting"
          ? { status: "queued", runner_id: null, offered_at: null }
          : { status: statusOf(to) },
      )
      .where("organization_id", "=", organizationId)
      .where("id", "=", jobId)
      .where("runner_id", "=", runnerId)
      .where("status", "=", statusOf(from))
      .executeTakeFirst();

    return result.numUpdatedRows > 0n;
  }
}

/**
 * The lost-runner predicate, over a query that has joined `runners`: offline or removed, and
 * either removed on purpose — no window brings that back — or silent since before the cutoff.
 *
 * @param cutoff - Runners last seen before this are lost.
 * @returns The condition.
 */
function lostRunner(cutoff: Date): RawBuilder<boolean> {
  return sql<boolean>`(runners.status in ('offline', 'removed')
    and (runners.desired_state = 'removed'
         or runners.last_seen_at is null
         or runners.last_seen_at < ${cutoff}))`;
}
