/**
 * Row builders for dispatch's unit suites (#252) — a build job and a pool shaped as the database
 * returns them, with the mockup's values, so each suite states only the field it varies.
 */

import type { BuildJob, RunnerPool } from "../../db/schema";
import type { JobView } from "./dispatch.repository";

/** A workspace. */
export const ORG = "org-farm";

/** A runner in it. */
export const RUNNER = "7f000002-0000-4000-8000-000000000001";

/** A second runner. */
export const OTHER_RUNNER = "7f000002-0000-4000-8000-000000000002";

/** The job the suites dispatch — mockup 08's `#479`. */
export const JOB = "5eed0028-0000-4000-8000-000000000479";

/** The exact commit it builds. */
export const COMMIT = "9e7bd4034c1f1b2a6d8e0f5c7a9b3d1e2f4a6c80";

/**
 * A build job row.
 *
 * @param overrides - The fields a case varies.
 * @returns The row: a waiting container build on pool-a.
 */
export function buildJob(overrides: Partial<BuildJob> = {}): BuildJob {
  return {
    id: JOB,
    organization_id: ORG,
    number: 479,
    pool_id: "7f000001-0000-4000-8000-000000000001",
    runner_id: null,
    run_id: null,
    github_repo_id: "7f000003-0000-4000-8000-000000000001",
    git_ref: "refs/heads/main",
    commit_sha: COMMIT,
    label: "zephyr build",
    title: "Add OTA rollback on failed checksum",
    executor: "container",
    image: "ghcr.io/acme-robotics/zephyr-sdk:0.17",
    command: "west build -b helios_mainboard app",
    env: {},
    status: "queued",
    queued_at: new Date("2026-09-19T12:00:00.000Z"),
    offered_at: null,
    started_at: null,
    finished_at: null,
    exit_code: null,
    ccache_stats: null,
    retry_of: null,
    log_bytes: "0",
    log_dropped_bytes: "0",
    log_cap_bytes: "67108864",
    log_truncated_at: null,
    log_agent_dropped_bytes: "0",
    log_missing_chunks: 0,
    log_swept_at: null,
    created_at: new Date("2026-09-19T12:00:00.000Z"),
    updated_at: new Date("2026-09-19T12:00:00.000Z"),
    artifact_globs: [],
    test_selection: null,
    ...overrides,
  };
}

/**
 * A pool row.
 *
 * @param overrides - The fields a case varies.
 * @returns The row: mockup 08's pool-a, with its default command.
 */
export function runnerPool(overrides: Partial<RunnerPool> = {}): RunnerPool {
  return {
    id: "7f000001-0000-4000-8000-000000000001",
    organization_id: ORG,
    name: "pool-a",
    description: "firmware builds",
    executor: "container",
    image: "ghcr.io/acme-robotics/zephyr-sdk:0.17",
    env_allowlist: [],
    max_concurrency: 2,
    enabled: true,
    autoscale_pref: {},
    tags: [],
    default_command: "west build -b helios_mainboard app",
    created_at: new Date("2026-09-19T12:00:00.000Z"),
    updated_at: new Date("2026-09-19T12:00:00.000Z"),
    artifact_globs: [],
    ...overrides,
  };
}

/**
 * A job with the names its resource prints.
 *
 * @param overrides - The job's fields a case varies.
 * @returns The view.
 */
export function jobView(overrides: Partial<BuildJob> = {}): JobView {
  return {
    job: buildJob(overrides),
    poolName: "pool-a",
    repoOwner: "acme-robotics",
    repoName: "helios-firmware",
  };
}
