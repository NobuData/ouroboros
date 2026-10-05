/**
 * The retention suites' shared bench — one finished piece of each loop-data class, planted at a
 * chosen age, and which of them each sweep has left (BQ.3 #482; shared since BR.6 #490).
 *
 * `retention.integration-spec.ts` and `settings/governance/audit.governance.integration-spec.ts`
 * both plant the same three classes against the real sweepers; one copy keeps them planting the
 * same thing.
 *
 * Not shipped: `*.fixture.ts` is excluded from the build.
 */

import { workspaceWithRepo, type SeededWorkspace } from "../../testing/dashboard.fixture";
import type { ApiHarness, Person } from "../../testing/harness.fixture";
import { SCHEMA_NAME } from "../db/schema";
import { LogRetentionSweeper } from "../farm/logs/log.retention";
import { TranscriptRetentionSweeper } from "../runs/transcript.retention";
import { ArtifactRetentionSweeper } from "../test-results-read/artifact.retention";

/** One day, in milliseconds. */
export const DAY_MS = 86_400_000;

/** One finished piece of each swept loop-data class. */
export interface Planted {
  readonly jobId: string;
  readonly artifactId: string;
  readonly runId: string;
}

/** Which of a planted set each sweep has left. */
export interface Kept {
  readonly logs: boolean;
  readonly artifact: boolean;
  readonly transcript: boolean;
}

/** A workspace with a repository and a build pool, and its owner. */
export interface RetentionBench {
  readonly owner: Person;
  readonly at: SeededWorkspace;
  readonly poolId: string;
}

/**
 * A workspace with a repository and a build pool.
 *
 * @param api - The harness.
 * @returns The bench.
 */
export async function retentionBench(api: ApiHarness): Promise<RetentionBench> {
  const owner = await api.signIn();
  const at = await workspaceWithRepo(api, owner);
  const { rows } = await api.sql.query<{ id: string }>(
    `insert into ${SCHEMA_NAME}.runner_pools (organization_id, name, executor, image)
     values ($1, 'pool-a', 'container', 'img:0.17') returning id`,
    [at.id],
  );

  return { owner, at, poolId: rows[0].id };
}

/**
 * A finished build with a log, an artifact, and a finished run with a transcript — every one
 * stored `ageMs` ago.
 *
 * @param api - The harness.
 * @param at - The workspace.
 * @param poolId - Its pool.
 * @param ageMs - How long ago each was stored, in milliseconds.
 * @returns Their ids.
 */
export async function plantLoopData(
  api: ApiHarness,
  at: SeededWorkspace,
  poolId: string,
  ageMs: number,
): Promise<Planted> {
  const stored = new Date(Date.now() - ageMs);

  const { rows: jobs } = await api.sql.query<{ id: string }>(
    `insert into ${SCHEMA_NAME}.build_jobs
       (organization_id, number, pool_id, github_repo_id, git_ref, commit_sha, label, title,
        executor, image, command, status, queued_at)
     values ($1, (select coalesce(max(number), 0) + 1 from ${SCHEMA_NAME}.build_jobs
                   where organization_id = $1),
             $2, $3, 'refs/heads/main', repeat('a', 40), 'build', 'Build firmware',
             'container', 'img:0.17', 'make all', 'queued', $4)
     returning id`,
    [at.id, poolId, at.repoId, new Date(stored.getTime() - 60_000)],
  );
  await api.sql.query(
    `insert into ${SCHEMA_NAME}.build_log_chunks (job_id, seq, content, received_at, retain_until)
     values ($1, 0, $2, $3, $3::timestamptz + interval '30 days')`,
    [jobs[0].id, Buffer.from("$ west build\n"), stored],
  );
  await api.sql.query(
    `update ${SCHEMA_NAME}.build_jobs set status = 'canceled', finished_at = $2 where id = $1`,
    [jobs[0].id, stored],
  );

  const { rows: runs } = await api.sql.query<{ id: string }>(
    `insert into ${SCHEMA_NAME}.runs (organization_id, github_repo_id, issue_number, issue_title,
                                 workflow_tag, model, status, stage_label, stage_index,
                                 stage_total, started_at, finished_at)
     values ($1, $2, 482, 'Fix flaky CAN-bus telemetry test', 'standard-fix',
             'claude-fable-5', 'failed', 'Build farm', 5, 6, $3, $4)
     returning id`,
    [at.id, at.repoId, new Date(stored.getTime() - 60_000), stored],
  );
  await api.sql.query(
    `insert into ${SCHEMA_NAME}.run_events (run_id, actor, stage_key, attempt, body)
     values ($1, 'plan', 'plan', 1, 'Reproduce the flake first.'),
            ($1, 'plan', 'plan', 1, 'Then fix the ISR ordering.')`,
    [runs[0].id],
  );

  const { rows: attempts } = await api.sql.query<{ id: string }>(
    `insert into ${SCHEMA_NAME}.test_runs (organization_id, run_id, attempt_seq, started_at, created_at)
     values ($1, $2, 1, $3, $3) returning id`,
    [at.id, runs[0].id, stored],
  );
  const { rows: artifacts } = await api.sql.query<{ id: string }>(
    `insert into ${SCHEMA_NAME}.test_artifacts
       (organization_id, test_run_id, name, kind, size_bytes, storage_ref, checksum,
        retained_until, created_at)
     values ($1, $2, 'serial-console.log', 'log', 13, $3::jsonb, $4, $5, $6) returning id`,
    [
      at.id,
      attempts[0].id,
      JSON.stringify({ driver: "local", key: `${at.id}/retention/serial-console.log` }),
      `sha256:${"0".repeat(64)}`,
      new Date(stored.getTime() + 30 * DAY_MS),
      stored,
    ],
  );

  return { jobId: jobs[0].id, artifactId: artifacts[0].id, runId: runs[0].id };
}

/**
 * Which of a planted set is still kept.
 *
 * @param api - The harness.
 * @param planted - The set.
 * @returns Each class's survival.
 */
export async function keptOf(api: ApiHarness, planted: Planted): Promise<Kept> {
  const { rows } = await api.sql.query<Kept>(
    `select (select log_swept_at is null from ${SCHEMA_NAME}.build_jobs where id = $1) as logs,
            (select expired_at is null from ${SCHEMA_NAME}.test_artifacts where id = $2) as artifact,
            (select events_swept_at is null
                    and exists (select 1 from ${SCHEMA_NAME}.run_events where run_id = $3)
               from ${SCHEMA_NAME}.runs where id = $3) as transcript`,
    [planted.jobId, planted.artifactId, planted.runId],
  );

  return rows[0];
}

/**
 * Run each loop-data sweep once, as its timer would.
 *
 * @param api - The harness.
 * @returns What each removed.
 */
export async function sweepLoopData(
  api: ApiHarness,
): Promise<{ logs: number; artifacts: number; transcripts: number }> {
  const logs = await api.nest.get(LogRetentionSweeper).sweep();
  const artifacts = await api.nest.get(ArtifactRetentionSweeper).sweep();
  const transcripts = await api.nest.get(TranscriptRetentionSweeper).sweep();

  return { logs: logs.byAge, artifacts: artifacts.expired, transcripts: transcripts.runs };
}
