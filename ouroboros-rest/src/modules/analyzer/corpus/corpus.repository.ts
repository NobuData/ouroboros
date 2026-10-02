/**
 * Every read the Build Analyzer's corpus makes, bounded and paged (BV.1,
 * [#510](https://github.com/NobuData/ouroboros/issues/510), decision **A2**).
 *
 * **No method here returns a whole plane.** A count is an aggregate; a list is a page — keyset,
 * never `offset`, so page *n* costs what page 1 did — and a log is read a few chunks at a time from
 * its end (`log.tail.ts`). The assembler decides how many pages to take; this file only promises
 * that each one is small.
 *
 * Every query is scoped to the workspace **and** the repository. The repository is resolved once,
 * through the workspace's own GitHub organizations, so another workspace's repository of the same
 * name is not this one.
 *
 * Days are UTC days (`(timestamptz at time zone 'UTC')::date`), as everywhere in the analysis and
 * insights domains.
 */

import { Injectable } from "@nestjs/common";
import { sql } from "kysely";

import { DatabaseService } from "../../db/db.service";
import { addDays, dayStart } from "../../insights/rollup/rollup.days";
import type {
  EngineCandidateEvent,
  EngineFlakeScore,
  EngineLoop,
  EngineSeriesPoint,
  EngineTestCase,
  EngineWaiver,
} from "../../engine/engine.analysis";
import type { CorpusWindow } from "./corpus.manifest";
import type { LogChunk } from "./log.tail";

/** Builds per page. */
export const BUILD_PAGE = 500;

/** Loops per page. */
export const LOOP_PAGE = 500;

/** Test runs per page. */
export const TEST_RUN_PAGE = 200;

/** Log chunks per page, read from the end of a build's log. */
export const LOG_CHUNK_PAGE = 4;

/** The longest failure message a test case carries into the corpus, in characters. */
export const FAILURE_CHARS = 2000;

/** The repository a corpus is read for. */
export interface CorpusScope {
  organizationId: string;
  repoRef: string;
  /** `github_repos.id`. */
  repoId: string;
}

/** What lies inside the window — the strip's numbers, counted without reading a row of them. */
export interface CorpusCounts {
  builds: number;
  hilSessions: number;
  logLines: number;
  loops: number;
  /** Days of the window on which at least one build finished — for the confidence note. */
  daysWithBuilds: number;
}

/** One finished build, as a page carries it. */
export interface BuildRow {
  id: string;
  /** `md5(id)` — the sample order. */
  hash: string;
  label: string;
  status: "succeeded" | "failed" | "retried";
  day: string;
  durationSeconds: number | null;
  logLines: number;
  ccacheStats: unknown;
  /** Whether it ran on a pool tagged `hil` — a HIL session. */
  hil: boolean;
}

/** Where a page of builds resumes. */
export interface BuildCursor {
  hash: string;
  id: string;
}

/**
 * The window as a half-open instant range.
 *
 * @param window - The corpus window.
 * @returns `[from, to)` — the first instant of `from` and the first instant after `to`.
 */
function instants(window: CorpusWindow): { from: Date; to: Date } {
  return { from: dayStart(window.from), to: dayStart(addDays(window.to, 1)) };
}

/** A UTC day, as SQL text. */
const utcDay = (column: string) =>
  sql<string>`to_char((${sql.ref(column)} at time zone 'UTC')::date, 'YYYY-MM-DD')`;

/** A count column, which `pg` reads as a string. */
const asNumber = (value: string | number | null | undefined): number =>
  value === null || value === undefined ? 0 : Number(value);

@Injectable()
export class CorpusRepository {
  /** @param database - The typed connection. */
  constructor(private readonly database: DatabaseService) {}

  /**
   * The workspace's repository behind a reference.
   *
   * @param organizationId - The workspace.
   * @param repoRef - `owner/name`.
   * @returns Its `github_repos.id`, or undefined when the workspace has no such repository.
   */
  async repository(organizationId: string, repoRef: string): Promise<string | undefined> {
    const { rows } = await sql<{ id: string }>`
      select repo.id
        from ouroboros.github_repos repo
        join ouroboros.github_orgs gh on gh.id = repo.org_id
       where gh.organization_id = ${organizationId}
         and gh.login || '/' || repo.name = ${repoRef}
       limit 1`.execute(this.database.db);

    return rows[0]?.id;
  }

  /**
   * The window's counts.
   *
   * A **build** is a farm job of the repository that finished `succeeded`, `failed` or `retried`
   * inside the window (BI.2's population); a **HIL session** is such a build on a pool tagged
   * `hil`; **log lines** are what those builds stored (`build_jobs.log_lines`); a **loop** is a
   * run of the repository that started inside the window.
   *
   * @param scope - The repository.
   * @param window - The window.
   * @returns The counts.
   */
  async counts(scope: CorpusScope, window: CorpusWindow): Promise<CorpusCounts> {
    const { from, to } = instants(window);

    const { rows } = await sql<{
      builds: string;
      hil: string;
      log_lines: string;
      days: string;
      loops: string;
    }>`
      select count(*) as builds,
             count(*) filter (where pool.tags ? 'hil') as hil,
             coalesce(sum(b.log_lines), 0) as log_lines,
             count(distinct (b.finished_at at time zone 'UTC')::date) as days,
             (select count(*) from ouroboros.runs r
               where r.organization_id = ${scope.organizationId}
                 and r.github_repo_id = ${scope.repoId}
                 and r.started_at >= ${from} and r.started_at < ${to}) as loops
        from ouroboros.build_jobs b
        join ouroboros.runner_pools pool on pool.id = b.pool_id
       where b.organization_id = ${scope.organizationId}
         and b.github_repo_id = ${scope.repoId}
         and b.status in ('succeeded', 'failed', 'retried')
         and b.finished_at >= ${from} and b.finished_at < ${to}`.execute(this.database.db);

    const row = rows[0];

    return {
      builds: asNumber(row?.builds),
      hilSessions: asNumber(row?.hil),
      logLines: asNumber(row?.log_lines),
      loops: asNumber(row?.loops),
      daysWithBuilds: asNumber(row?.days),
    };
  }

  /**
   * The job label whose durations are the repository's duration series: the label with the most
   * successful builds in the window, ties broken by name.
   *
   * A repository's farm runs several kinds of job — the firmware build, a simulator run, a HIL
   * sweep — and their lengths are not one series. The commonest successful one is the build.
   *
   * @param scope - The repository.
   * @param window - The window.
   * @returns The label, or null when nothing succeeded.
   */
  async durationLabel(scope: CorpusScope, window: CorpusWindow): Promise<string | null> {
    const { from, to } = instants(window);

    const { rows } = await sql<{ label: string }>`
      select b.label
        from ouroboros.build_jobs b
       where b.organization_id = ${scope.organizationId}
         and b.github_repo_id = ${scope.repoId}
         and b.status = 'succeeded'
         and b.finished_at >= ${from} and b.finished_at < ${to}
       group by b.label
       order by count(*) desc, b.label
       limit 1`.execute(this.database.db);

    return rows[0]?.label ?? null;
  }

  /**
   * One page of the window's builds, in sample order — `md5(id)`, which is stable across runs and
   * unrelated to time, so a sample cut short is spread across the window rather than its oldest
   * days.
   *
   * @param scope - The repository.
   * @param window - The window.
   * @param after - Where the previous page ended, or null for the first.
   * @param limit - How many.
   * @returns The page.
   */
  async buildPage(
    scope: CorpusScope,
    window: CorpusWindow,
    after: BuildCursor | null,
    limit: number = BUILD_PAGE,
  ): Promise<BuildRow[]> {
    const { from, to } = instants(window);
    const resume =
      after === null
        ? sql`true`
        : sql`(md5(b.id::text), b.id) > (${after.hash}, ${after.id}::uuid)`;

    const { rows } = await sql<{
      id: string;
      hash: string;
      label: string;
      status: BuildRow["status"];
      day: string;
      duration_seconds: number | null;
      log_lines: string;
      ccache_stats: unknown;
      hil: boolean;
    }>`
      select b.id, md5(b.id::text) as hash, b.label, b.status, ${utcDay("b.finished_at")} as day,
             extract(epoch from (b.finished_at - b.started_at))::float8 as duration_seconds,
             b.log_lines, b.ccache_stats, pool.tags ? 'hil' as hil
        from ouroboros.build_jobs b
        join ouroboros.runner_pools pool on pool.id = b.pool_id
       where b.organization_id = ${scope.organizationId}
         and b.github_repo_id = ${scope.repoId}
         and b.status in ('succeeded', 'failed', 'retried')
         and b.finished_at >= ${from} and b.finished_at < ${to}
         and ${resume}
       order by md5(b.id::text), b.id
       limit ${limit}`.execute(this.database.db);

    return rows.map((row) => ({
      id: row.id,
      hash: row.hash,
      label: row.label,
      status: row.status,
      day: row.day,
      durationSeconds: row.duration_seconds,
      logLines: asNumber(row.log_lines),
      ccacheStats: row.ccache_stats,
      hil: row.hil,
    }));
  }

  /**
   * A few of a build's log chunks, newest first.
   *
   * @param jobId - The build.
   * @param beforeSeq - Only chunks before this one; null for the newest.
   * @param limit - How many.
   * @returns The chunks.
   */
  async logChunks(
    jobId: string,
    beforeSeq: number | null,
    limit: number = LOG_CHUNK_PAGE,
  ): Promise<LogChunk[]> {
    const before = beforeSeq === null ? sql`true` : sql`c.seq < ${beforeSeq}`;

    const { rows } = await sql<{ seq: number; content: Buffer }>`
      select c.seq, c.content
        from ouroboros.build_log_chunks c
       where c.job_id = ${jobId} and ${before}
       order by c.seq desc
       limit ${limit}`.execute(this.database.db);

    return rows;
  }

  /**
   * The dated changes attribution ranks — the read shape `ouroboros-db`'s
   * `tests/lib/analyzer-corpus.sql` states, so the change-point analyzer sees here exactly what it
   * rediscovered the seeded findings from (#509):
   *
   *   * `merge` — a commit first built on the default branch, on that first build's queue day;
   *   * `policy_version` — a published version of one of the workspace's workflows;
   *   * `infra_event` — a runner enrolled, a pool's builds starting to run a new image, or a
   *     time-windowed pool assignment created.
   *
   * `config_version` and `env_recipe_version` are not emitted: a candidate must cite evidence V081
   * can resolve, and V081 has no evidence kind for either yet.
   *
   * @param scope - The repository.
   * @param window - The window.
   * @returns The events inside the window, ordered by day, kind and label.
   */
  async events(scope: CorpusScope, window: CorpusWindow): Promise<EngineCandidateEvent[]> {
    const { rows } = await sql<{
      kind: EngineCandidateEvent["kind"];
      day: string;
      label: string;
      ref: EngineCandidateEvent["ref"];
    }>`
      with jobs as (
        select job.*, (job.queued_at at time zone 'UTC')::date as queued_day
          from ouroboros.build_jobs job
         where job.organization_id = ${scope.organizationId}
           and job.github_repo_id = ${scope.repoId}
      ),
      first_builds as (
        select distinct on (job.commit_sha) job.commit_sha, job.queued_day, job.title
          from jobs job
         where job.git_ref = 'refs/heads/main' and job.commit_sha is not null
         order by job.commit_sha, job.queued_at, job.number
      ),
      pool_images as (
        select pool.id as pool_id, pool.name, job.image, job.queued_at,
               lag(job.image) over (partition by pool.id order by job.queued_at, job.number)
                 as previous
          from ouroboros.runner_pools pool
          join ouroboros.build_jobs job on job.pool_id = pool.id
         where pool.organization_id = ${scope.organizationId}
      ),
      events as (
        select 'merge' as kind, f.queued_day as day, f.title as label,
               jsonb_build_object('kind', 'merge', 'id', f.commit_sha) as ref
          from first_builds f
        union all
        select 'policy_version', (v.published_at at time zone 'UTC')::date,
               w.slug || ' v' || v.version,
               jsonb_build_object('kind', 'workflow_version', 'id', v.id::text)
          from ouroboros.workflows w
          join ouroboros.workflow_versions v on v.workflow_id = w.id and v.version is not null
         where w.organization_id = ${scope.organizationId}
        union all
        select 'infra_event', (r.enrolled_at at time zone 'UTC')::date, r.name || ' enrolled',
               jsonb_build_object('kind', 'runner', 'id', r.id::text)
          from ouroboros.runners r
         where r.organization_id = ${scope.organizationId}
        union all
        select 'infra_event', (p.queued_at at time zone 'UTC')::date,
               p.name || ' image ' || regexp_replace(p.image, '^.*/', ''),
               jsonb_build_object('kind', 'runner_pool', 'id', p.pool_id::text)
          from pool_images p
         where p.previous is not null and p.image is distinct from p.previous
        union all
        select 'infra_event', (w.created_at at time zone 'UTC')::date,
               runner.name || ' assigned to ' || pool.name || ' '
                 || to_char(w.starts_at, 'HH24:MI') || '–' || to_char(w.ends_at, 'HH24:MI'),
               jsonb_build_object('kind', 'runner_pool', 'id', pool.id::text)
          from ouroboros.runner_pool_windows w
          join ouroboros.runners runner on runner.id = w.runner_id
          join ouroboros.runner_pools pool on pool.id = w.pool_id
         where w.organization_id = ${scope.organizationId}
      )
      select e.kind, to_char(e.day, 'YYYY-MM-DD') as day, e.label, e.ref
        from events e
       where e.day between ${window.from}::date and ${window.to}::date
       order by e.day, e.kind, e.label`.execute(this.database.db);

    return rows.map((row) => ({ kind: row.kind, day: row.day, label: row.label, ref: row.ref }));
  }

  /**
   * One page of the window's test runs' cases that did not simply pass — failed (an `error` is a
   * failure), or flaky — with the failure message cut to {@link FAILURE_CHARS}. A test run belongs
   * to the repository through its loop or its build.
   *
   * @param scope - The repository.
   * @param window - The window.
   * @param afterRunId - The last test run of the previous page, or null.
   * @returns The cases, and the last test run the page reached (null when there are no more).
   */
  async testCasePage(
    scope: CorpusScope,
    window: CorpusWindow,
    afterRunId: string | null,
  ): Promise<{ cases: EngineTestCase[]; last: string | null }> {
    const { from, to } = instants(window);
    const resume = afterRunId === null ? sql`true` : sql`tr.id > ${afterRunId}::uuid`;

    const { rows: runs } = await sql<{ id: string }>`
      select tr.id
        from ouroboros.test_runs tr
        left join ouroboros.runs r on r.id = tr.run_id
        left join ouroboros.build_jobs b on b.id = tr.build_job_id
       where tr.organization_id = ${scope.organizationId}
         and (r.github_repo_id = ${scope.repoId} or b.github_repo_id = ${scope.repoId})
         and tr.started_at >= ${from} and tr.started_at < ${to}
         and ${resume}
       order by tr.id
       limit ${TEST_RUN_PAGE}`.execute(this.database.db);

    if (runs.length === 0) {
      return { cases: [], last: null };
    }

    const ids = runs.map((run) => run.id);
    const { rows } = await sql<{
      test_run_id: string;
      build_id: string | null;
      day: string;
      suite: string;
      platform: string | null;
      case_key: string;
      status: string;
      failure: string | null;
    }>`
      select tr.id as test_run_id, tr.build_job_id as build_id,
             ${utcDay("tr.started_at")} as day, s.name as suite, s.platform, c.case_key,
             c.status,
             left(coalesce(c.failure ->> 'message', c.failure ->> 'log_excerpt'), ${FAILURE_CHARS})
               as failure
        from ouroboros.test_runs tr
        join ouroboros.test_suites s on s.test_run_id = tr.id
        join ouroboros.test_cases c on c.test_suite_id = s.id
       where tr.id = any(${ids}::uuid[])
         and c.status in ('failed', 'error', 'flaky')
       order by tr.id, s.name, c.case_key`.execute(this.database.db);

    return {
      cases: rows.map((row) => ({
        test_run_id: row.test_run_id,
        build_id: row.build_id,
        day: row.day,
        suite: row.suite,
        platform: row.platform,
        case_key: row.case_key,
        status: row.status === "flaky" ? "flaky" : "failed",
        failure: row.failure,
      })),
      last: ids[ids.length - 1],
    };
  }

  /**
   * The repository's current flake scores — AT.3's rolling scores, not dated.
   *
   * @param scope - The repository.
   * @returns One per scored case.
   */
  async flakes(scope: CorpusScope): Promise<EngineFlakeScore[]> {
    const { rows } = await sql<{ case_key: string; score: string; state: string }>`
      select f.case_key, f.score, f.state
        from ouroboros.flake_scores f
       where f.organization_id = ${scope.organizationId}
         and f.github_repo_id = ${scope.repoId}
       order by f.case_key`.execute(this.database.db);

    return rows.map((row) => ({
      case_key: row.case_key,
      score: Number(row.score),
      state: row.state,
    }));
  }

  /**
   * One page of the window's loops — stage timings and transcript **statistics**: how many events
   * and how many bytes, never a body.
   *
   * @param scope - The repository.
   * @param window - The window.
   * @param afterId - The last loop of the previous page, or null.
   * @returns The page, by id.
   */
  async loopPage(
    scope: CorpusScope,
    window: CorpusWindow,
    afterId: string | null,
  ): Promise<EngineLoop[]> {
    const { from, to } = instants(window);
    const resume = afterId === null ? sql`true` : sql`r.id > ${afterId}::uuid`;

    const { rows } = await sql<{
      id: string;
      day: string;
      status: string;
      events: number;
      event_bytes: string;
      stages: EngineLoop["stages"];
    }>`
      select r.id, ${utcDay("r.started_at")} as day, r.status, r.event_seq as events,
             r.event_bytes,
             coalesce((
               select jsonb_agg(jsonb_build_object('key', s.stage_key, 'attempts', s.attempts,
                                                   'seconds', s.seconds)
                                order by s.first_position, s.stage_key)
                 from (select st.stage_key, count(*) as attempts, min(st.position) as first_position,
                              coalesce(sum(extract(epoch from (st.finished_at - st.started_at)))
                                         filter (where st.started_at is not null
                                                   and st.finished_at is not null), 0)::float8
                                as seconds
                         from ouroboros.run_stages st
                        where st.run_id = r.id
                        group by st.stage_key) s), '[]'::jsonb) as stages
        from ouroboros.runs r
       where r.organization_id = ${scope.organizationId}
         and r.github_repo_id = ${scope.repoId}
         and r.started_at >= ${from} and r.started_at < ${to}
         and ${resume}
       order by r.id
       limit ${LOOP_PAGE}`.execute(this.database.db);

    return rows.map((row) => ({
      run_id: row.id,
      day: row.day,
      status: row.status,
      stages: row.stages,
      events: row.events,
      event_bytes: asNumber(row.event_bytes),
    }));
  }

  /**
   * The waivers written on the repository's loops inside the window (AS.4).
   *
   * @param scope - The repository.
   * @param window - The window.
   * @returns One per waiver, oldest first.
   */
  async waivers(scope: CorpusScope, window: CorpusWindow): Promise<EngineWaiver[]> {
    const { from, to } = instants(window);

    const { rows } = await sql<{
      id: string;
      run_id: string;
      day: string;
      case_keys: string[];
      reason: string;
    }>`
      select w.id, w.run_id, ${utcDay("w.created_at")} as day, w.case_keys, w.reason
        from ouroboros.pr_waivers w
        join ouroboros.runs r on r.id = w.run_id
       where w.organization_id = ${scope.organizationId}
         and r.github_repo_id = ${scope.repoId}
         and w.created_at >= ${from} and w.created_at < ${to}
       order by w.created_at, w.id`.execute(this.database.db);

    return rows.map((row) => ({
      waiver_id: row.id,
      run_id: row.run_id,
      day: row.day,
      case_keys: row.case_keys,
      reason: row.reason,
    }));
  }

  /**
   * A rolled-up metric's daily rows for the repository — BI's grain, every dimension.
   *
   * @param scope - The repository.
   * @param window - The window.
   * @param metricId - The metric, e.g. `build_duration`.
   * @returns One point per (day, dimension), ordered.
   */
  async series(
    scope: CorpusScope,
    window: CorpusWindow,
    metricId: string,
  ): Promise<EngineSeriesPoint[]> {
    const { rows } = await sql<{ day: string; dimension: string; value: string; samples: unknown }>`
      select to_char(d.day, 'YYYY-MM-DD') as day, d.dimension, d.value,
             coalesce(d.meta -> 'samples', '[]'::jsonb) as samples
        from ouroboros.metric_daily d
       where d.organization_id = ${scope.organizationId}
         and d.repo_ref = ${scope.repoRef}
         and d.metric_id = ${metricId}
         and d.day between ${window.from}::date and ${window.to}::date
       order by d.day, d.dimension`.execute(this.database.db);

    return rows.map((row) => ({
      day: row.day,
      dimension: row.dimension,
      value: Number(row.value),
      samples: Array.isArray(row.samples) ? row.samples.map(Number) : [],
    }));
  }
}
