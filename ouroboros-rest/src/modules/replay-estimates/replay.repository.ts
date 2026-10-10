/**
 * The statements behind the replay estimators (CD.3,
 * [#561](https://github.com/NobuData/ouroboros/issues/561)).
 *
 * The arithmetic is not written here. V121 owns the similarity class
 * (`build_similarity_class()`, `test_similarity_class()`), the statistics
 * (`build_replay_sample()`, `test_replay_sample()`) and the policy
 * (`replay_estimate_policy()`), so the dev seed's replayed row and this service are one
 * computation. What is here is the lookup around them: the workspace and repository a dry run
 * is about, the pool a stage names, and the function calls with the database's own clock as the
 * window's end.
 *
 * Every read names the workspace. The dry run is found by id alone because the engine names
 * nothing else — the workspace is the dry run's, never the caller's.
 */

import { Injectable } from "@nestjs/common";
import { sql } from "kysely";

import { DatabaseService } from "../db/db.service";
import { SCHEMA_NAME } from "../db/schema";
import type { CacheSample, ReplayPolicy, ReplaySample } from "./replay.estimate";

/** The workspace and repository a dry run is about. */
export interface ReplayContext {
  /** The dry run's workspace. */
  readonly organizationId: string;
  /** The repository its ticket names, or `null` when the workspace mirrors no such repository. */
  readonly repository: { readonly id: string; readonly name: string } | null;
}

/** The sample of the builds similar to a stage. */
export interface BuildSampleRow {
  /** The command the class was formed from — the stage's, else the pool's default; `null` when neither exists. */
  readonly command: string | null;
  /** The similarity class, as printed; `null` exactly when {@link command} is. */
  readonly similarityClass: string | null;
  /** The window and floor in force. */
  readonly policy: ReplayPolicy;
  /** The statistics. */
  readonly sample: ReplaySample;
  /** The cache halves. */
  readonly cache: CacheSample;
}

/** The sample of the test runs similar to a suite set. */
export interface TestSampleRow {
  /** The suite set matched — the one named, else the repository's last measured; `null` when there is none. */
  readonly suites: readonly string[] | null;
  /** The similarity class, as printed; `null` exactly when {@link suites} is. */
  readonly similarityClass: string | null;
  /** The window and floor in force. */
  readonly policy: ReplayPolicy;
  /** The statistics. */
  readonly sample: ReplaySample;
}

/**
 * A nullable `bigint` column as a number.
 *
 * @param value - What the driver returned: a string, a number or `null`.
 * @returns The number, or `null`.
 */
function nullableNumber(value: string | number | null): number | null {
  return value === null ? null : Number(value);
}

@Injectable()
export class ReplayEstimateRepository {
  /** @param database - The connection. */
  constructor(private readonly database: DatabaseService) {}

  /**
   * The workspace and repository a dry run is about.
   *
   * The repository is the one the dry run's ticket names (`meta.github.owner` / `repo`, which
   * the GitHub mapper writes), matched case-insensitively against the workspace's mirror.
   *
   * @param dryRunId - The dry run.
   * @returns The context, or `undefined` when no dry run has this id.
   */
  async context(dryRunId: string): Promise<ReplayContext | undefined> {
    const schema = sql.id(SCHEMA_NAME);
    const { rows } = await sql<{
      organization_id: string;
      repo_id: string | null;
      repo_name: string | null;
    }>`
      select r.organization_id, repo.id as repo_id, repo.name as repo_name
        from ${schema}.dry_runs r
        join ${schema}.tickets t on t.id = r.ticket_id and t.organization_id = r.organization_id
        left join ${schema}.github_orgs gh
               on gh.organization_id = r.organization_id
              and lower(gh.login) = lower(t.meta #>> '{github,owner}')
        left join ${schema}.github_repos repo
               on repo.org_id = gh.id
              and lower(repo.name) = lower(t.meta #>> '{github,repo}')
       where r.id = ${dryRunId}::uuid
    `.execute(this.database.db);
    const row = rows[0];

    if (row === undefined) return undefined;

    return {
      organizationId: row.organization_id,
      repository:
        row.repo_id === null || row.repo_name === null
          ? null
          : { id: row.repo_id, name: row.repo_name },
    };
  }

  /**
   * The sample of the builds similar to a stage: same workspace, repository, pool, executor and
   * configuration class, succeeded, finished within the policy's window ending now.
   *
   * The executor and image are the pool's as it is configured today — what a build dispatched
   * from this stage would run under.
   *
   * @param organizationId - The workspace.
   * @param repository - The repository's id and name.
   * @param runnerPool - The pool's name.
   * @param command - The stage's command, or `null` to take the pool's default.
   * @returns The sample, or `undefined` when the workspace has no pool of that name.
   */
  async buildSample(
    organizationId: string,
    repository: { readonly id: string; readonly name: string },
    runnerPool: string,
    command: string | null,
  ): Promise<BuildSampleRow | undefined> {
    const schema = sql.id(SCHEMA_NAME);
    const { rows } = await sql<{
      command: string | null;
      similarity_class: string | null;
      window_days: number;
      sample_floor: number;
      sample_count: string;
      median_ms: string | null;
      spread_ms: string | null;
      cache_measured: string;
      warm_count: string;
      warm_median_ms: string | null;
      cold_count: string;
      cold_median_ms: string | null;
    }>`
      select stage.command,
             ${schema}.build_similarity_class(p.name, ${repository.name}, p.executor, p.image,
                                              stage.command) as similarity_class,
             policy.window_days, policy.sample_floor,
             s.sample_count, s.median_ms, s.spread_ms, s.cache_measured,
             s.warm_count, s.warm_median_ms, s.cold_count, s.cold_median_ms
        from ${schema}.runner_pools p
        cross join lateral (select coalesce(${command}::text, p.default_command) as command) stage
        cross join ${schema}.replay_estimate_policy() policy
        cross join lateral ${schema}.build_replay_sample(
                     p.organization_id, ${repository.id}::uuid, p.id, p.executor, p.image,
                     stage.command, now(), policy.window_days) s
       where p.organization_id = ${organizationId}
         and p.name = ${runnerPool}
    `.execute(this.database.db);
    const row = rows[0];

    if (row === undefined) return undefined;

    return {
      command: row.command,
      similarityClass: row.similarity_class,
      policy: { windowDays: row.window_days, sampleFloor: row.sample_floor },
      sample: {
        sampleCount: Number(row.sample_count),
        medianMs: nullableNumber(row.median_ms),
        spreadMs: nullableNumber(row.spread_ms),
      },
      cache: {
        measured: Number(row.cache_measured),
        warmCount: Number(row.warm_count),
        warmMedianMs: nullableNumber(row.warm_median_ms),
        coldCount: Number(row.cold_count),
        coldMedianMs: nullableNumber(row.cold_median_ms),
      },
    };
  }

  /**
   * The sample of the test runs similar to a suite set: complete, measured runs of the
   * repository that reported exactly that set, started within the policy's window ending now.
   * Read from test history only — a build's duration never enters it.
   *
   * @param organizationId - The workspace.
   * @param repository - The repository's id and name.
   * @param suites - The suite set, or `null` to take the one the repository last measured.
   * @returns The sample. Its `suites` is `null` when none was named and the repository has no
   *   measured test run.
   */
  async testSample(
    organizationId: string,
    repository: { readonly id: string; readonly name: string },
    suites: readonly string[] | null,
  ): Promise<TestSampleRow> {
    const schema = sql.id(SCHEMA_NAME);
    const { rows } = await sql<{
      suites: string[] | null;
      similarity_class: string | null;
      window_days: number;
      sample_floor: number;
      sample_count: string;
      median_ms: string | null;
      spread_ms: string | null;
    }>`
      select s.suites,
             ${schema}.test_similarity_class(${repository.name}, s.suites) as similarity_class,
             policy.window_days, policy.sample_floor,
             s.sample_count, s.median_ms, s.spread_ms
        from ${schema}.replay_estimate_policy() policy
        cross join lateral ${schema}.test_replay_sample(
                     ${organizationId}, ${repository.id}::uuid,
                     ${suites === null ? null : [...suites]}::text[], now(),
                     policy.window_days) s
    `.execute(this.database.db);
    // A function call in `from` always answers one row.
    const row = rows[0];

    return {
      suites: row.suites,
      similarityClass: row.similarity_class,
      policy: { windowDays: row.window_days, sampleFloor: row.sample_floor },
      sample: {
        sampleCount: Number(row.sample_count),
        medianMs: nullableNumber(row.median_ms),
        spreadMs: nullableNumber(row.spread_ms),
      },
    };
  }
}
