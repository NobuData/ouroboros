/**
 * What the replay estimators refuse, and why (CD.3,
 * [#561](https://github.com/NobuData/ouroboros/issues/561)).
 *
 * None of these is "too little history" — that is an answer, not an error
 * (`replay.estimate.ts`). These are requests that name something the workspace does not have, so
 * there is no class to sample at all.
 */

import { InvalidRequestError, NotFoundError } from "../errors/error.envelope";

/** Every code this module answers with, documented in `openapi.internal.yaml`. */
export const REPLAY_ERRORS = {
  /** No dry run has this id. `404`. */
  dryRunNotFound: "dry_run_not_found",
  /** The dry run's ticket names no repository this workspace mirrors. `422`. */
  repositoryUnresolved: "replay_repository_unresolved",
  /** A build estimate was asked for without a runner pool. `422`. */
  poolRequired: "replay_pool_required",
  /** The workspace has no runner pool of that name. `422`. */
  poolNotFound: "replay_pool_not_found",
  /** Neither the request nor the pool names a command, so there is no class to match. `422`. */
  commandRequired: "replay_command_required",
} as const;

/**
 * No dry run has this id.
 *
 * @param dryRun - The id asked for.
 * @returns The `404`.
 */
export function dryRunNotFound(dryRun: string): NotFoundError {
  return new NotFoundError(REPLAY_ERRORS.dryRunNotFound, "There is no dry run with this id.", {
    dryRun,
  });
}

/**
 * The dry run's ticket names no repository this workspace mirrors.
 *
 * @param dryRun - The dry run.
 * @returns The `422`.
 */
export function repositoryUnresolved(dryRun: string): InvalidRequestError {
  return new InvalidRequestError(
    REPLAY_ERRORS.repositoryUnresolved,
    "This dry run's ticket names no repository of the workspace, so there is no history to replay.",
    { dryRun },
  );
}

/**
 * A build estimate was asked for without a runner pool.
 *
 * @returns The `422`.
 */
export function poolRequired(): InvalidRequestError {
  return new InvalidRequestError(
    REPLAY_ERRORS.poolRequired,
    "A build estimate needs the stage's runner pool: builds are comparable within one pool.",
    {},
  );
}

/**
 * The workspace has no runner pool of that name.
 *
 * @param runnerPool - The name asked for.
 * @returns The `422`.
 */
export function poolNotFound(runnerPool: string): InvalidRequestError {
  return new InvalidRequestError(
    REPLAY_ERRORS.poolNotFound,
    "This workspace has no runner pool with that name.",
    { runnerPool },
  );
}

/**
 * Neither the request nor the pool names a command.
 *
 * @param runnerPool - The pool, which has no default command.
 * @returns The `422`.
 */
export function commandRequired(runnerPool: string): InvalidRequestError {
  return new InvalidRequestError(
    REPLAY_ERRORS.commandRequired,
    "The stage names no command and its pool has no default one, so there is no build to compare with.",
    { runnerPool },
  );
}
