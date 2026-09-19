/**
 * A placed job, as the `job.offer` its runner is sent.
 *
 * AH.4 ([#252](https://github.com/NobuData/ouroboros/issues/252)). Every field of the offer
 * (`docs/RUNNER_PROTOCOL.md` § 4.3) comes from the job's own row — the executor, image and command
 * it snapshotted from its pool when it was submitted — or from `dispatch.policy.ts`. Nothing is
 * read through the pool at dispatch time: a pool edited after a build was submitted must not
 * change what that build runs.
 *
 * ```
 * build_jobs row                       job.offer
 *   id                            ──▶  job: job_<ULID of the id>   (one attempt, one job id)
 *   executor · image              ──▶  executor · image            (image for a container only)
 *   command (canonical text)      ──▶  command: argv               (command.ts, never split)
 *   github repo · git_ref · sha   ──▶  repository {url, ref, commit}
 *   retry_of chain                ──▶  attempt                     (only when > 1)
 * ```
 */

import type { BuildJob } from "../../db/schema";
import type { JobOfferPayload } from "../protocol/protocol.messages";
import { wireId } from "../protocol/ulid";
import { parseCommand } from "./command";
import { CONTAINER_WORKDIR, JOB_TIMEOUT_S, SHELL_WORKDIR } from "./dispatch.policy";

/** The protocol's ceiling on an offer's `env` entries. */
const ENV_MAX_ENTRIES = 128;

/** Everything an offer is built from. */
export interface OfferSource {
  readonly job: BuildJob;
  readonly poolName: string;
  readonly repoOwner: string;
  readonly repoName: string;
  readonly attempt: number;
}

/**
 * Why a job cannot be offered at all — a record this service did not write, or wrote under
 * rules that no longer hold. `undefined` when it can.
 *
 * @param job - The row.
 * @returns A sentence for the log, or `undefined`.
 */
export function undispatchable(job: Pick<BuildJob, "command" | "commit_sha">): string | undefined {
  if (!job.commit_sha) {
    return "it names no commit, and an offer must pin the exact commit it builds";
  }
  if (!parseCommand(job.command)) {
    return "its command is not the canonical rendering of an argv, and free text is never split";
  }
  return undefined;
}

/**
 * The clone URL of a repository the workspace mirrors from GitHub.
 *
 * @param owner - The owner, as V003 stores it.
 * @param name - The repository.
 * @returns `https://github.com/<owner>/<name>.git`.
 */
export function cloneUrl(owner: string, name: string): string {
  return `https://github.com/${owner}/${name}.git`;
}

/**
 * A job's `env` column as an offer carries it: string values only, within the protocol's bound.
 * The pool's allow-list is the agent's to apply (`ack.pool.env_allowlist`), and it does.
 *
 * @param column - `build_jobs.env`, as the driver returned it.
 * @returns The environment.
 */
export function envOf(column: unknown): Record<string, string> {
  if (typeof column !== "object" || column === null || Array.isArray(column)) return {};

  return Object.fromEntries(
    Object.entries(column as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .slice(0, ENV_MAX_ENTRIES),
  );
}

/**
 * Build the offer.
 *
 * @param source - The placed job and the names it needs.
 * @param expiresAt - When the offer stops being answerable.
 * @returns The payload — still to be held to the contract by `AgentSessions.offer`.
 * @throws {TypeError} If the job is {@link undispatchable}; the dispatcher checks first.
 */
export function offerPayload(source: OfferSource, expiresAt: Date): JobOfferPayload {
  const { job } = source;
  const argv = parseCommand(job.command);

  if (!argv || !job.commit_sha) {
    throw new TypeError(`build job ${job.id} cannot be offered: ${undispatchable(job) ?? ""}`);
  }

  return {
    job: wireId("job", job.id),
    pool: source.poolName,
    executor: job.executor,
    ...(job.executor === "container" && job.image !== null ? { image: job.image } : {}),
    command: argv,
    workdir: job.executor === "container" ? CONTAINER_WORKDIR : SHELL_WORKDIR,
    env: envOf(job.env),
    repository: {
      url: cloneUrl(source.repoOwner, source.repoName),
      ref: job.git_ref,
      commit: job.commit_sha,
    },
    timeout_s: JOB_TIMEOUT_S,
    expires_at: expiresAt.toISOString(),
    ...(source.attempt > 1 ? { attempt: source.attempt } : {}),
  };
}
