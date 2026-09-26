/**
 * A build job, as the API returns it.
 *
 * AH.4 ([#252](https://github.com/NobuData/ouroboros/issues/252)). The shape AI.5's submit dialog
 * (#260) toasts and AH.6's read APIs (#254) will list. camelCase, ISO 8601 instants, `null` for
 * what has not happened yet — `farm.resources.ts`'s conventions.
 */

import type { BuildExecutor, BuildJobStatus } from "../../db/schema";
import { parseCommand } from "./command";
import type { JobView } from "./dispatch.repository";

/**
 * Where a just-submitted job honestly stands (#332) — never *"started"*, because nothing has
 * started when the request returns:
 *
 *   * `offered` — dispatch has already offered it to a runner (or the runner has taken it);
 *   * `queued_runner_available` — queued, and at least one runner is eligible for it now, so
 *     placement is a dispatcher pass away;
 *   * `queued_no_eligible_runner` — queued, and **no runner is eligible**: offline, drained,
 *     full, or without the job's executor. It waits in its pool's queue until one is.
 */
export type DispatchQueueState =
  "offered" | "queued_runner_available" | "queued_no_eligible_runner";

/** A re-run just submitted, and where it honestly stands. */
export interface RerunDispatch {
  readonly job: BuildJobResource;
  readonly queueState: DispatchQueueState;
}

/** One build attempt. */
export interface BuildJobResource {
  readonly id: string;
  /** The job's public name within its workspace — mockup 08's `#479`. */
  readonly number: number;
  /** V040's status: `queued`, `offered`, `running`, `succeeded`, `failed`, `retried` or `canceled`. */
  readonly status: BuildJobStatus;
  /** The pool it was submitted to, by name. */
  readonly pool: string;
  /** The repository, as GitHub's `owner/name`. */
  readonly repository: string;
  readonly ref: string;
  /** The exact commit it builds. Null only on a record this API did not write. */
  readonly commit: string | null;
  /** argv — or null for a stored command that is not a canonical rendering of one. */
  readonly command: readonly string[] | null;
  /** The command as the runners table prints it. */
  readonly commandLine: string;
  /** What it runs under — snapshotted from its pool at submission. */
  readonly executor: BuildExecutor;
  /** The container image, for a container job. */
  readonly image: string | null;
  readonly label: string;
  readonly title: string;
  /** The runner holding or last holding it; null while it waits in its pool's queue. */
  readonly runnerId: string | null;
  /** The loop run it belongs to — null for every user- and API-submitted build (B6). */
  readonly runId: string | null;
  /** The attempt this one retries, when it is an automatic retry. */
  readonly retryOf: string | null;
  readonly queuedAt: string;
  readonly offeredAt: string | null;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly exitCode: number | null;
}

/**
 * A job as the API describes it.
 *
 * @param view - The row, with its pool's and repository's names.
 * @returns The resource.
 */
export function buildJobResource(view: JobView): BuildJobResource {
  const { job } = view;

  return {
    id: job.id,
    number: job.number,
    status: job.status,
    pool: view.poolName,
    repository: `${view.repoOwner}/${view.repoName}`,
    ref: job.git_ref,
    commit: job.commit_sha,
    command: parseCommand(job.command) ?? null,
    commandLine: job.command,
    executor: job.executor,
    image: job.image,
    label: job.label,
    title: job.title,
    runnerId: job.runner_id,
    runId: job.run_id,
    retryOf: job.retry_of,
    queuedAt: job.queued_at.toISOString(),
    offeredAt: job.offered_at?.toISOString() ?? null,
    startedAt: job.started_at?.toISOString() ?? null,
    finishedAt: job.finished_at?.toISOString() ?? null,
    exitCode: job.exit_code,
  };
}
