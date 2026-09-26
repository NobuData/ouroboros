/**
 * Artifact globs — which files a build uploads beyond the built-in result set (#330).
 *
 * A pool names the files every one of its builds collects (`runner_pools.artifact_globs`: a rig
 * pool's `captures/*.csv`); a submission adds its own (`serial-console.log`); the job snapshots the
 * two together at submit time (`build_jobs.artifact_globs`). The rule each glob is held to is
 * V060's `artifact_globs_valid()`, restated so a request that would be refused by the database is
 * refused as a `422` first.
 */

import {
  ValidatorConstraint,
  type ValidationArguments,
  type ValidatorConstraintInterface,
} from "class-validator";

/** The most globs a pool, or a submission, may name — half the column's 64, so the two always fit. */
export const ARTIFACT_GLOBS_MAX = 32;

/** The longest glob — V060's bound. */
export const ARTIFACT_GLOB_MAX_LENGTH = 256;

/**
 * Whether one glob is relative to the job's working directory and stays inside it.
 *
 * @param glob - The candidate.
 * @returns True for 1–256 characters, no leading `/`, no `..` segment, no backslash, no control
 *   character.
 */
export function isArtifactGlob(glob: unknown): glob is string {
  return (
    typeof glob === "string" &&
    glob.length >= 1 &&
    glob.length <= ARTIFACT_GLOB_MAX_LENGTH &&
    !glob.startsWith("/") &&
    !/(^|\/)\.\.(\/|$)/.test(glob) &&
    !/[\\\p{Cc}]/u.test(glob)
  );
}

/**
 * The job's snapshot: the pool's globs, then the submission's, without repeats.
 *
 * @param poolGlobs - `runner_pools.artifact_globs`, as the driver returned it.
 * @param requested - The submission's `artifacts`, when it named any.
 * @returns At most `2 × ARTIFACT_GLOBS_MAX` globs — within the column's bound.
 */
export function snapshotGlobs(poolGlobs: unknown, requested: readonly string[] = []): string[] {
  const pool = Array.isArray(poolGlobs) ? poolGlobs.filter(isArtifactGlob) : [];

  return [...new Set([...pool, ...requested])];
}

/** A set of up to {@link ARTIFACT_GLOBS_MAX} distinct artifact globs. */
@ValidatorConstraint({ name: "isArtifactGlobs" })
export class IsArtifactGlobs implements ValidatorConstraintInterface {
  /**
   * @param value - What the field carries.
   * @returns Whether every glob is relative and the set is bounded and distinct.
   */
  validate(value: unknown): boolean {
    return (
      Array.isArray(value) &&
      value.length <= ARTIFACT_GLOBS_MAX &&
      value.every(isArtifactGlob) &&
      new Set(value).size === value.length
    );
  }

  /**
   * @param args - The validation context.
   * @returns What the client is told.
   */
  defaultMessage(args: ValidationArguments): string {
    return (
      `${args.property} must be up to ${String(ARTIFACT_GLOBS_MAX)} distinct globs relative to ` +
      `the job's working directory: at most ${String(ARTIFACT_GLOB_MAX_LENGTH)} characters, no ` +
      "leading /, no .. segment, no backslash"
    );
  }
}
