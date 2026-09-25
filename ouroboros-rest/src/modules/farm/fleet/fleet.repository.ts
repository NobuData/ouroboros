/**
 * Every statement mockup 08's read surfaces and lifecycle actions issue, in one class.
 *
 * AH.6 ([#254](https://github.com/NobuData/ouroboros/issues/254)). `farm.repository.ts`'s
 * posture, inherited rather than restated: **every statement carries `organization_id`**,
 * including the ones whose composite foreign keys would have carried it anyway, because the
 * schema constrains writes and it is the `where` that makes a *read* tenant-scoped.
 *
 * ---------------------------------------------------------------------------
 * **The page is four statements, not four-plus-one-per-runner.**
 *
 * A runners table of N rows needs each row's queue depth and current build.
 * `DispatchRepository.queueDepth` answers that for one runner and is the definition this file
 * is held to — {@link queueDepths} is the same predicate as a `group by`, asserted against it
 * by the suite so the two cannot drift. Asking it N times would be an N+1 against a table
 * that grows with a workspace's build history, on the page a workspace leaves open. The
 * certificate each runner presents ({@link liveCertificates}, AI.5's details sheet —
 * [#260](https://github.com/NobuData/ouroboros/issues/260)) is read the same way: one set
 * statement for the fleet, never one per row.
 *
 * ---------------------------------------------------------------------------
 * **`coalesce(avg(…), 0)` appears nowhere here, and that is the point.**
 *
 * `dashboard/dashboard.repository.ts` uses exactly that for its cycle-time meter, and it is
 * right there: a pulse meter over an empty week is honestly zero-length. It would be wrong
 * here. An average build time of `0m 00s` is not a fast farm, so this file returns the
 * **sum and the count separately** and lets `fleet.stats.ts` decide that no builds means no
 * mean. The zero the database would helpfully supply is the exact value the acceptance
 * criteria refuse.
 */

import { Injectable } from "@nestjs/common";
import { sql } from "kysely";

import { DatabaseService } from "../../db/db.service";
import type {
  BuildJob,
  PoolExecutor,
  Runner,
  RunnerCertificate,
  RunnerPool,
  RunnerStatus,
} from "../../db/schema";
import type { CacheAggregate, DurationAggregate } from "./fleet.stats";
import type { FarmWindows } from "./fleet.policy";

/**
 * The statuses a build passes through that mean *it ran and reached an outcome*.
 *
 * What the day's mean duration is taken over. `canceled` is **not** among them and that is a
 * decision: a cancelled build's elapsed time is how long the farm was busy before somebody
 * changed their mind, which is not a build time, and a build cancelled before it ever started
 * has no elapsed time at all. It is still counted in *builds today* — it happened — and
 * `fleet.stats.ts` gives it its own bucket so the partition still adds up.
 */
const MEASURED_STATUSES = ["succeeded", "failed", "retried"] as const;

/** A runner row with its pool's name, which the table prints as a tag. */
export interface RunnerRow {
  readonly runner: Runner;
  readonly poolName: string;
}

/** A pool row with the runner count its meta line prints. */
export interface PoolRow {
  readonly pool: RunnerPool;
  readonly runners: number;
}

/**
 * A pool as an insert must describe it.
 *
 * The two columns V040 gives no default to and no sensible one exists for: a pool with no
 * name cannot be referred to by `--pool`, and a pool with no executor has no way to run
 * anything. Everything else in {@link PoolWrite} has a column default.
 */
export type NewPool = PoolWrite & { readonly name: string; readonly executor: PoolExecutor };

/** The day's and the prior week's aggregates, from one statement over one set of boundaries. */
export interface FarmAggregates {
  /** Today's terminal builds, by outcome. */
  readonly outcomes: {
    readonly succeeded: number;
    readonly retried: number;
    readonly failed: number;
    readonly canceled: number;
  };
  /** Today's measured durations. */
  readonly today: DurationAggregate;
  /** The prior seven whole days'. */
  readonly prior: DurationAggregate;
  /** Today's ccache totals. */
  readonly cache: CacheAggregate;
}

/** A pool's mutable columns, as the CRUD routes write them. */
export interface PoolWrite {
  readonly name?: string;
  readonly description?: string | null;
  readonly executor?: PoolExecutor;
  readonly image?: string | null;
  readonly env_allowlist?: unknown;
  readonly max_concurrency?: number;
  readonly enabled?: boolean;
  readonly autoscale_pref?: unknown;
  readonly tags?: unknown;
  readonly default_command?: string | null;
  readonly artifact_globs?: unknown;
}

@Injectable()
export class FleetRepository {
  /**
   * @param database - The typed connection. Injected, never constructed.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * One workspace's fleet, with each runner's pool name.
   *
   * **Retired machines are absent**, and from every count taken over this list with them.
   * V040 keeps a `removed` runner's row because its builds reference it, and the seed puts a
   * sixth machine in that state precisely so a fleet count that forgets to exclude it reads
   * six. `status` alone is enough to exclude it: `runners_removed_is_intended` makes
   * `status = 'removed'` and `desired_state = 'removed'` the same fact.
   *
   * Ordered by name, which `runners_organization_name_idx` serves. A stable order rather than
   * the mockup's status grouping: the grouping is a presentation choice AI.2
   * ([#257](https://github.com/NobuData/ouroboros/issues/257)) can make from the `status` it
   * is given, and an API that sorted by it would change row order as machines came and went.
   *
   * @param organizationId - The workspace.
   * @returns The fleet, by name.
   */
  async runners(organizationId: string): Promise<RunnerRow[]> {
    const rows = await this.database.db
      .selectFrom("runners")
      .innerJoin("runner_pools", "runner_pools.id", "runners.pool_id")
      .where("runners.organization_id", "=", organizationId)
      .where("runners.status", "!=", "removed")
      .selectAll("runners")
      .select("runner_pools.name as pool_name")
      .orderBy("runners.name")
      .execute();

    return rows.map(({ pool_name, ...runner }) => ({ runner, poolName: pool_name }));
  }

  /**
   * One runner of one workspace, retired ones included.
   *
   * Included, unlike {@link runners}, because the lifecycle actions have to be able to say
   * *this machine has already been removed* rather than *no such machine* — a `404` for a row
   * that is right there is the answer that sends somebody looking for a bug.
   *
   * @param organizationId - The workspace.
   * @param id - The runner.
   * @returns The row, or `undefined`.
   */
  async runnerById(organizationId: string, id: string): Promise<Runner | undefined> {
    return this.database.db
      .selectFrom("runners")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("id", "=", id)
      .executeTakeFirst();
  }

  /**
   * How many builds are waiting on each runner — the table's `q:N`.
   *
   * **`status = 'queued'` with a runner assigned**, which is
   * `DispatchRepository.queueDepth`'s predicate exactly: work the runner has been given and
   * has not started. An outstanding offer is not in it and neither is the running build. The
   * two are held to each other by `fleet.repository.integration-spec.ts`, because a queue chip
   * that disagreed with the dispatcher would be two sources for one answer.
   *
   * @param organizationId - The workspace.
   * @returns Depth by runner id. **Runners with nothing waiting are absent** — a `group by`
   *   has no row for them — so callers read through a default of zero rather than expecting a
   *   key per runner.
   */
  async queueDepths(organizationId: string): Promise<Map<string, number>> {
    const rows = await this.database.db
      .selectFrom("build_jobs")
      .where("organization_id", "=", organizationId)
      .where("status", "=", "queued")
      .where("runner_id", "is not", null)
      .groupBy("runner_id")
      .select(({ fn }) => ["runner_id", fn.countAll<string>().as("depth")])
      .execute();

    return new Map(
      rows
        .filter((row) => row.runner_id)
        .map((row) => [row.runner_id as string, Number(row.depth)]),
    );
  }

  /**
   * What each runner is building right now.
   *
   * `running` only. An `offered` job has been sent to a machine that has not accepted it yet,
   * and printing it in the *Current job* cell would show a build as under way before anything
   * had started compiling.
   *
   * A pool may let one runner hold several at once (`max_concurrency`), so where there is more
   * than one the **most recently started** wins — the same build the live card shows, so the
   * row and the card never name different work for one machine.
   *
   * @param organizationId - The workspace.
   * @returns The build by runner id, most recent first per runner.
   */
  async currentJobs(organizationId: string): Promise<Map<string, BuildJob>> {
    const rows = await this.database.db
      .selectFrom("build_jobs")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("status", "=", "running")
      .where("runner_id", "is not", null)
      .orderBy("started_at", "desc")
      .execute();

    const current = new Map<string, BuildJob>();
    for (const job of rows) {
      if (job.runner_id && !current.has(job.runner_id)) current.set(job.runner_id, job);
    }

    return current;
  }

  /**
   * The certificate each runner is presenting — what AI.5's details sheet
   * ([#260](https://github.com/NobuData/ouroboros/issues/260)) prints as a serial and a
   * renewal date.
   *
   * **Live** is `FarmRepository.liveCertificate`'s predicate exactly — not revoked and not
   * superseded — as a set over the workspace rather than a lookup for one machine. V041's
   * `runner_certificates_live_idx` makes it unique per runner, so the map cannot hold a
   * second candidate. *Live* is not *valid*: a machine that has been off for a quarter still
   * holds a certificate whose `not_after` has passed, and saying so is the sheet's to do.
   *
   * @param organizationId - The workspace.
   * @returns The certificate by runner id. **A runner without one is absent** — a machine on
   *   the bearer fallback has none by construction (decision B3), and a revoked one has none
   *   any more.
   */
  async liveCertificates(organizationId: string): Promise<Map<string, RunnerCertificate>> {
    const rows = await this.database.db
      .selectFrom("runner_certificates")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("revoked", "=", false)
      .where("superseded_at", "is", null)
      .execute();

    return new Map(rows.map((row) => [row.runner_id, row]));
  }

  /**
   * The build the LIVE card shows — the one that started most recently.
   *
   * *Most recently started*, because the card is what the farm is doing **now**: mockup 08
   * shows `#479`, three minutes in on `forge-01`, while `#472` has been sweeping a HIL rig
   * since this morning on a draining machine. The newest build is the one somebody is waiting
   * on; the long one is a fact the runners table already carries.
   *
   * @param organizationId - The workspace.
   * @returns The build and its runner's name, or `undefined` when nothing is running.
   */
  async liveBuild(
    organizationId: string,
  ): Promise<{ job: BuildJob; runner: string | null } | undefined> {
    const row = await this.database.db
      .selectFrom("build_jobs")
      .leftJoin("runners", "runners.id", "build_jobs.runner_id")
      .where("build_jobs.organization_id", "=", organizationId)
      .where("build_jobs.status", "=", "running")
      .selectAll("build_jobs")
      .select("runners.name as runner_name")
      .orderBy("build_jobs.started_at", "desc")
      .limit(1)
      .executeTakeFirst();

    if (!row) return undefined;
    const { runner_name, ...job } = row;

    return { job, runner: runner_name };
  }

  /**
   * One workspace's pools, with the runner count each card prints.
   *
   * A left join, so **a pool with no runners is a row with a count of zero** rather than a
   * pool that has vanished from the card. Retired machines are excluded inside the join
   * condition rather than in the `where`, which is the difference between *this pool has no
   * live runners* and *this pool is not here*.
   *
   * @param organizationId - The workspace.
   * @returns The pools, by name.
   */
  async pools(organizationId: string): Promise<PoolRow[]> {
    const rows = await this.database.db
      .selectFrom("runner_pools")
      .leftJoin("runners", (join) =>
        join.onRef("runners.pool_id", "=", "runner_pools.id").on("runners.status", "!=", "removed"),
      )
      .where("runner_pools.organization_id", "=", organizationId)
      .groupBy("runner_pools.id")
      .selectAll("runner_pools")
      .select(sql<number>`count(runners.id)::int`.as("runner_count"))
      .orderBy("runner_pools.name")
      .execute();

    return rows.map(({ runner_count, ...pool }) => ({ pool, runners: runner_count }));
  }

  /**
   * Every windowed figure on the stat row, from one statement.
   *
   * One statement because the day's count, the day's mean and the day's cache rate are three
   * claims about **one** set of rows: run as three queries a few milliseconds apart, a build
   * that finished on the boundary would be inside one figure and outside the next, and the
   * card would say 23 builds averaged over 22.
   *
   * The window is closed at both ends — `[dayStart, now]` — rather than left open at the top.
   * A build that finishes while this statement runs belongs to the next poll's window, which
   * is what makes *the numbers on this payload* reproducible from the boundaries beside them.
   *
   * @param organizationId - The workspace.
   * @param windows - The boundaries, computed once for this read.
   * @returns The aggregates. Sums and counts, never means — see this file's header.
   */
  async aggregates(organizationId: string, windows: FarmWindows): Promise<FarmAggregates> {
    const { dayStart, priorStart, now } = windows;
    const measured = sql`status = any(${sql.val([...MEASURED_STATUSES])}::text[])`;
    const today = sql`finished_at >= ${dayStart} and finished_at <= ${now}`;
    const prior = sql`finished_at >= ${priorStart} and finished_at < ${dayStart}`;
    const duration = sql`extract(epoch from (finished_at - started_at))`;

    const row = await this.database.db
      .selectFrom("build_jobs")
      .where("organization_id", "=", organizationId)
      .select([
        // The day's partition. Four aliases rather than a `group by`, so an outcome that did
        // not happen today is a zero rather than a missing row — `dashboard.repository.ts`
        // takes the same position, for the same reason.
        sql<number>`count(*) filter (where status = ${"succeeded"} and ${today})::int`.as(
          "succeeded",
        ),
        sql<number>`count(*) filter (where status = ${"retried"} and ${today})::int`.as("retried"),
        sql<number>`count(*) filter (where status = ${"failed"} and ${today})::int`.as("failed"),
        sql<number>`count(*) filter (where status = ${"canceled"} and ${today})::int`.as(
          "canceled",
        ),

        // The sum and the count, separately, for each window. `coalesce(…, 0)` on the *sum*
        // is safe and on a mean would not be: a sum of no rows is genuinely zero seconds,
        // and it is the count beside it that says whether dividing by it means anything.
        // `started_at is not null` is belt to the braces of `build_jobs_started_when_run`,
        // which already guarantees it for these three statuses.
        sql<number>`count(*) filter (
          where ${measured} and ${today} and started_at is not null
        )::int`.as("today_builds"),
        sql<number>`coalesce(sum(${duration}) filter (
          where ${measured} and ${today} and started_at is not null
        ), 0)::float8`.as("today_seconds"),
        sql<number>`count(*) filter (
          where ${measured} and ${prior} and started_at is not null
        )::int`.as("prior_builds"),
        sql<number>`coalesce(sum(${duration}) filter (
          where ${measured} and ${prior} and started_at is not null
        ), 0)::float8`.as("prior_seconds"),

        // The cache rate is weighted: Σ hits over Σ objects, not a mean of per-build rates.
        // A build carrying no summary matches neither filter and so contributes to neither
        // sum — which is how `null` stays *not measured* rather than becoming a zero that
        // drags the rate down (decision B5, and `build_ccache_stats_valid`'s own comment).
        // `numeric` because the CHECK permits any non-negative number, `float8` because a
        // day's object count is nowhere near where a double stops being exact.
        sql<number>`coalesce(sum((ccache_stats->>'hits')::numeric) filter (
          where ${today} and ccache_stats is not null
        ), 0)::float8`.as("cache_hits"),
        sql<number>`coalesce(sum(
          (ccache_stats->>'hits')::numeric + (ccache_stats->>'misses')::numeric
        ) filter (where ${today} and ccache_stats is not null), 0)::float8`.as("cache_objects"),
      ])
      .executeTakeFirstOrThrow();

    return {
      outcomes: {
        succeeded: row.succeeded,
        retried: row.retried,
        failed: row.failed,
        canceled: row.canceled,
      },
      today: { builds: row.today_builds, totalSeconds: row.today_seconds },
      prior: { builds: row.prior_builds, totalSeconds: row.prior_seconds },
      cache: { hits: row.cache_hits, objects: row.cache_objects },
    };
  }

  /**
   * Retire a runner: observation and intent, in one write.
   *
   * **Both columns, or neither** — `runners_removed_is_intended`. The database would refuse a
   * half-removal, and setting them together here is what keeps that constraint a statement of
   * the rule rather than a trap the service falls into.
   *
   * The telemetry and uptime go with it. A retired machine's last snapshot renders exactly
   * like a live one, which is the argument V040's presence sweep already makes when it clears
   * them on going offline.
   *
   * @param organizationId - The workspace.
   * @param id - The runner.
   * @param guard - The statuses it may be removed from — the caller's guard, applied **in the
   *   statement**. Passed rather than checked above and trusted, so that a runner which came
   *   back online between the check and the write is not removed out from under a build.
   * @returns The removed row, or `undefined` when it no longer matched the guard.
   */
  async remove(
    organizationId: string,
    id: string,
    guard: readonly RunnerStatus[],
  ): Promise<Runner | undefined> {
    return this.database.db
      .updateTable("runners")
      .set({
        status: "removed",
        desired_state: "removed",
        // As the presence sweep writes it (`gateway.repository.ts`): `pg` serialises a
        // plain object to JSON, so this is the empty document rather than a literal.
        telemetry: {},
        uptime_seconds: null,
      })
      .where("organization_id", "=", organizationId)
      .where("id", "=", id)
      .where("status", "in", [...guard])
      .returningAll()
      .executeTakeFirst();
  }

  /**
   * One workspace's pool, by id.
   *
   * @param organizationId - The workspace.
   * @param id - The pool.
   * @returns The row, or `undefined`.
   */
  async poolById(organizationId: string, id: string): Promise<RunnerPool | undefined> {
    return this.database.db
      .selectFrom("runner_pools")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("id", "=", id)
      .executeTakeFirst();
  }

  /**
   * Create a pool.
   *
   * @param organizationId - The workspace.
   * @param write - The columns, already validated by the DTO. V040's CHECKs are the second
   *   line and the one that cannot be bypassed — a container pool with no image is refused
   *   here whatever this service believed.
   * @returns The stored row.
   */
  async insertPool(organizationId: string, write: NewPool): Promise<RunnerPool> {
    return this.database.db
      .insertInto("runner_pools")
      .values({ ...write, organization_id: organizationId })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Change a pool.
   *
   * @param organizationId - The workspace.
   * @param id - The pool.
   * @param write - Only the columns the request named; an absent one is left alone, which is
   *   what makes this a `PATCH` rather than a replacement that silently clears what it was
   *   not told about.
   * @returns The stored row, or `undefined` when there is no such pool here.
   */
  async updatePool(
    organizationId: string,
    id: string,
    write: PoolWrite,
  ): Promise<RunnerPool | undefined> {
    return this.database.db
      .updateTable("runner_pools")
      .set(write)
      .where("organization_id", "=", organizationId)
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
  }

  /**
   * Delete a pool.
   *
   * @param organizationId - The workspace.
   * @param id - The pool.
   * @returns Whether a row went.
   */
  async deletePool(organizationId: string, id: string): Promise<boolean> {
    const result = await this.database.db
      .deleteFrom("runner_pools")
      .where("organization_id", "=", organizationId)
      .where("id", "=", id)
      .executeTakeFirst();

    return (result.numDeletedRows ?? 0n) > 0n;
  }

  /**
   * What still points at a pool — what makes deleting it refusable with a reason.
   *
   * Both counts in one statement, and **runners include retired ones**: V040's
   * `runners_pool_fk` is `no action` and refuses the delete whether or not the machine is
   * retired, so a count that excluded them would promise a delete PostgreSQL then rejects
   * with a foreign-key violation nobody can read.
   *
   * @param organizationId - The workspace.
   * @param id - The pool.
   * @returns How many runners and how many builds name it.
   */
  async poolReferences(
    organizationId: string,
    id: string,
  ): Promise<{ runners: number; jobs: number }> {
    const [runners, jobs] = await Promise.all([
      this.database.db
        .selectFrom("runners")
        .where("organization_id", "=", organizationId)
        .where("pool_id", "=", id)
        .select(({ fn }) => fn.countAll<string>().as("count"))
        .executeTakeFirstOrThrow(),
      this.database.db
        .selectFrom("build_jobs")
        .where("organization_id", "=", organizationId)
        .where("pool_id", "=", id)
        .select(({ fn }) => fn.countAll<string>().as("count"))
        .executeTakeFirstOrThrow(),
    ]);

    return { runners: Number(runners.count), jobs: Number(jobs.count) };
  }
}
