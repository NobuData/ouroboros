/**
 * The environment-recipe service's refusals (BG.4,
 * [#420](https://github.com/NobuData/ouroboros/issues/420)), each a code `openapi.yaml` publishes.
 */

import { ConflictError, InvalidRequestError, NotFoundError } from "../errors/error.envelope";

/** The codes, as one object. */
export const ENV_RECIPE_ERRORS = {
  /** The repository has no recipe version at all. */
  notFound: "env_recipe_not_found",
  /** Another editor saved the next version first; re-read and edit again. */
  versionConflict: "env_recipe_version_conflict",
  /** V073's `env_recipe_commands_typed` refused the commands. */
  commandsInvalid: "env_recipe_commands_invalid",
} as const;

/** V073's constraint and trigger names, as the service catches them (`violatesConstraint`). */
export const ENV_RECIPE_CONSTRAINTS = {
  /** The BEFORE INSERT trigger: a version must be exactly one above the highest. */
  nextVersion: "env_recipes_next_version",
  /** `unique (organization_id, repo_ref, version)` — what a race loses on. */
  versionKey: "env_recipes_repo_version_key",
  /** The typed-array CHECK on `commands`. */
  commandsTyped: "env_recipes_commands_typed",
} as const;

/**
 * `404` — the repository has no recipe (a valid state the card draws as *no environment recipe
 * yet*).
 *
 * @param repo - The repository, `owner/name`.
 * @returns The error.
 */
export function envRecipeNotFound(repo: string): NotFoundError {
  return new NotFoundError(
    ENV_RECIPE_ERRORS.notFound,
    "This repository has no environment recipe yet.",
    { repo },
  );
}

/**
 * `409` — two editors computed the same next version and the other one committed first.
 *
 * @param repo - The repository.
 * @param version - The version this save tried to write.
 * @returns The error.
 */
export function envRecipeVersionConflict(repo: string, version: number): ConflictError {
  return new ConflictError(
    ENV_RECIPE_ERRORS.versionConflict,
    `Version ${String(version)} of ${repo}'s environment recipe was saved by someone else; ` +
      "re-read it and edit again.",
    { repo, version },
  );
}

/**
 * `422` — the database's own shape check refused the commands, which the request validation
 * should have caught first; answered rather than crashed so a gap between the two is visible.
 *
 * @param repo - The repository.
 * @returns The error.
 */
export function envRecipeCommandsInvalid(repo: string): InvalidRequestError {
  return new InvalidRequestError(
    ENV_RECIPE_ERRORS.commandsInvalid,
    "The commands are not the typed ordered array an environment recipe stores.",
    { repo },
  );
}
