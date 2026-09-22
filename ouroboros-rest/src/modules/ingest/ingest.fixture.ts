/**
 * A workspace an executor can actually open a run in.
 *
 * The ingestion contract resolves everything from rows rather than from the request — the
 * workspace from the ticket, the labels and limits from the pinned workflow — so a bench for
 * it is four rows deep before the first request can succeed: a workspace with a repository, a
 * ticket source, a mirrored ticket, and a published workflow version.
 *
 * The document is `schemas/workflow-dsl/fixtures/valid/standard-fix.json`, the same one the
 * studio's suites publish and the one mockup 10's run is drawn from — so the stage keys,
 * titles and limits a test asserts are the product's own rather than a shape written to make
 * a test pass. `implement` allows two retries there, which is what makes *attempt 2/3* and
 * *attempt 4 refused* both real numbers.
 *
 * Rows are written with SQL rather than through the API, for the reason every bench in this
 * service gives: arranging a fixture through the service under test makes the arrangement
 * part of what is asserted.
 *
 * Nothing here ships: `tsconfig.build.json` excludes `*.fixture.ts`.
 */

import { workspaceWithRepo, type SeededWorkspace } from "../../testing/dashboard.fixture";
import type { ApiHarness, Person } from "../../testing/harness.fixture";
import { readFixture } from "../workflows/dsl.golden.fixture";
import { SCHEMA_NAME } from "../db/schema";

/** The workflow every run in these suites pins. */
export const WORKFLOW_TAG = "standard-fix";

/**
 * The version it pins.
 *
 * `1`, not mockup 10's `v14`: V029 numbers published versions densely, so a workflow whose
 * first publish claimed to be the fourteenth is a workflow the database refuses. The number in
 * the mockup is a seed's history rather than anything the contract requires, and a bench that
 * published thirteen throwaway versions to reach it would be arranging a fixture around a
 * caption.
 */
export const WORKFLOW_VERSION = 1;

/** The ticket's display key, in V030's vocabulary. */
export const TICKET_KEY = "#482";

/** What `implement` allows under the pinned document: `limits.max_retries` of 2, plus one. */
export const IMPLEMENT_MAX_ATTEMPTS = 3;

/** Everything a request needs to name. */
export interface IngestBench {
  /** The workspace, and the repository a run works in. */
  readonly workspace: SeededWorkspace;
  /** `ticket_sources.id`. */
  readonly source: string;
  /** The body of `POST /internal/runs`, minus the idempotency key. */
  readonly open: Record<string, unknown>;
}

/**
 * Seed a workspace, a mirrored ticket and a published workflow version.
 *
 * @param api - The started harness. Its own connection writes these rows.
 * @param owner - Who owns the workspace.
 * @param externalId - The ticket's tracker identity, which becomes `runs.issue_number`.
 *   Defaults to `482`; a non-numeric value is how the `ticket_not_numbered` case is arranged.
 * @returns The bench.
 */
export async function seedIngestBench(
  api: ApiHarness,
  owner: Person,
  externalId = "482",
): Promise<IngestBench> {
  const workspace = await workspaceWithRepo(api, owner);

  const { rows: sources } = await api.sql.query<{ id: string }>(
    `insert into ${SCHEMA_NAME}.ticket_sources (organization_id, kind, display_name)
     values ($1, 'github', 'GitHub · helios') returning id`,
    [workspace.id],
  );
  const source = sources[0].id;

  await api.sql.query(
    `insert into ${SCHEMA_NAME}.tickets
       (organization_id, source_id, external_id, external_key, external_url, title, state,
        labels, source_created_at, source_updated_at, meta)
     values ($1, $2, $3, $4, 'https://github.com/acme/helios/issues/482',
             'Fix flaky CAN-bus telemetry test', 'open', '[]'::jsonb,
             now() - interval '2 days', now() - interval '1 hour', '{}'::jsonb)`,
    [workspace.id, source, externalId, TICKET_KEY],
  );

  // Three statements rather than two, and the order is the foreign key's:
  // `workflows_current_version_fk` points at a version row, so a workflow cannot claim to be
  // in force on a version that does not exist yet.
  const { rows: workflows } = await api.sql.query<{ id: string }>(
    `insert into ${SCHEMA_NAME}.workflows (organization_id, slug, name, status)
     values ($1, $2, $2, 'active') returning id`,
    [workspace.id, WORKFLOW_TAG],
  );

  await api.sql.query(
    `insert into ${SCHEMA_NAME}.workflow_versions
       (workflow_id, version, definition, published_at)
     values ($1, $2, $3::jsonb, now())`,
    [workflows[0].id, WORKFLOW_VERSION, JSON.stringify(readFixture("valid/standard-fix.json"))],
  );

  await api.sql.query(`update ${SCHEMA_NAME}.workflows set current_version = $2 where id = $1`, [
    workflows[0].id,
    WORKFLOW_VERSION,
  ]);

  return {
    workspace,
    source,
    open: {
      ticket: { source, externalKey: TICKET_KEY },
      repository: workspace.repoId,
      workflow: { tag: WORKFLOW_TAG, version: WORKFLOW_VERSION },
      model: "claude-fable-5",
      branchName: "loop/482-canbus-flake",
      mergeStrategy: "squash",
    },
  };
}

/**
 * A build job the run can reserve.
 *
 * The farm's own shape, not a reduced one: a job hangs off a pool and a repository, and V047's
 * reservation is a **composite** foreign key on `(reserved_build_job_id, organization_id)` —
 * so a fixture that skipped the pool would be refused by the database rather than by the suite
 * that called this.
 *
 * @param api - The started harness.
 * @param bench - The workspace to create it in.
 * @param number - The job's display number. Defaults to `483`, the farm job mockup 10's
 *   Resources card reserves.
 * @returns `build_jobs.id`.
 */
export async function seedReservableJob(
  api: ApiHarness,
  bench: IngestBench,
  number = 483,
): Promise<string> {
  const { rows: pools } = await api.sql.query<{ id: string }>(
    `insert into ${SCHEMA_NAME}.runner_pools (organization_id, name, executor, image)
     values ($1, $2, 'container', 'ghcr.io/nobudata/zephyr-build:0.17') returning id`,
    [bench.workspace.id, `forge-${String(number)}`],
  );

  const { rows: jobs } = await api.sql.query<{ id: string }>(
    `insert into ${SCHEMA_NAME}.build_jobs
       (organization_id, number, pool_id, github_repo_id, git_ref, commit_sha,
        label, title, executor, image, command, status)
     values ($1, $2, $3, $4, 'refs/heads/loop/482-canbus-flake', repeat('a', 40),
             'build', 'Build firmware', 'container', 'ghcr.io/nobudata/zephyr-build:0.17',
             'make all', 'queued')
     returning id`,
    [bench.workspace.id, number, pools[0].id, bench.workspace.repoId],
  );

  return jobs[0].id;
}
