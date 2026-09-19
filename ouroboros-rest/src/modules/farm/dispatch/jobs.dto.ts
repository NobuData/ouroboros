/**
 * The body of `POST /api/v1/farm/jobs`, and the request AJ.3's internal surface takes.
 *
 * AH.4 ([#252](https://github.com/NobuData/ouroboros/issues/252)). *Pool, repo ref, command (or
 * the pool default)* — decision **B6** scopes the MVP's submissions to users and the API, and the
 * shape is the same for the internal entry point workflow builds will use (`jobs.service.ts`).
 *
 * **There is no workspace field.** The workspace is the session's, resolved by the tenant guard,
 * so a body cannot name somebody else's pool — the organization-isolation criterion, made
 * unaskable rather than checked.
 *
 * **The command is argv, never a string.** The protocol refuses a shell string for its reason — a
 * quoted path that a splitter gets wrong is a build that fails for a reason nobody can see — and
 * so does this body: a client that has a string must split it itself, where the person who wrote
 * it can see the result.
 *
 * **The commit is required.** An offer pins the exact commit it builds (`job.offer.repository.commit`),
 * so a moving ref cannot change what was built after the fact; a submission that named only a
 * branch would leave the dispatcher to guess which commit the person meant.
 */

import {
  IsArray,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  Validate,
  ValidatorConstraint,
  type ValidationArguments,
  type ValidatorConstraintInterface,
} from "class-validator";

/** The most words a command may have — the protocol's `job.offer.command` ceiling. */
export const ARGV_MAX_ITEMS = 256;

/** The longest word a command may carry. */
export const ARGV_ITEM_MAX_LENGTH = 4096;

/** A pool name — V040's `runner_pools_name_shape`. */
const POOL_SHAPE = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/;

/** A GitHub `owner/name`. Case is ignored: V003 stores both lower-cased. */
const REPOSITORY_SHAPE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;

/** A git ref as the offer carries it: non-empty, no whitespace. */
const REF_SHAPE = /^\S+$/;

/** The exact commit — the protocol's `repository.commit` pattern. */
const COMMIT_SHAPE = /^[0-9a-f]{40}$/;

/** What a build request says — the route's body and the internal surface's argument alike. */
export interface BuildJobRequest {
  /** The pool to build in, by name. */
  readonly pool: string;
  /** The repository to build, as GitHub's `owner/name`. */
  readonly repository: string;
  /** The ref the commit was taken from — `refs/heads/main`, `refs/pull/971/head`. */
  readonly ref: string;
  /** The exact commit, 40 lower-case hex characters. */
  readonly commit: string;
  /** argv; the pool's default when absent. */
  readonly command?: readonly string[];
  /** The one-line description the live card prints; derived from the repository when absent. */
  readonly title?: string;
  /** The short label the runners table prints beside the number; the pool's name when absent. */
  readonly label?: string;
}

/**
 * argv, bounded: 1–{@link ARGV_MAX_ITEMS} strings of at most {@link ARGV_ITEM_MAX_LENGTH}
 * characters, the first — the program — not empty. A later word may be empty, as `sh -c ''` has
 * every right to be.
 */
@ValidatorConstraint({ name: "isArgv" })
export class IsArgv implements ValidatorConstraintInterface {
  /**
   * @param value - What the field carries.
   * @returns Whether it is argv the offer can carry.
   */
  validate(value: unknown): boolean {
    return (
      Array.isArray(value) &&
      value.length >= 1 &&
      value.length <= ARGV_MAX_ITEMS &&
      value.every((word) => typeof word === "string" && word.length <= ARGV_ITEM_MAX_LENGTH) &&
      value[0] !== ""
    );
  }

  /**
   * @param args - The validation context.
   * @returns What the client is told.
   */
  defaultMessage(args: ValidationArguments): string {
    return (
      `${args.property} must be argv: 1 to ${String(ARGV_MAX_ITEMS)} strings of at most ` +
      `${String(ARGV_ITEM_MAX_LENGTH)} characters, the first not empty`
    );
  }
}

/** The body of `POST /api/v1/farm/jobs`. */
export class SubmitBuildJobDto implements BuildJobRequest {
  @IsString()
  @Matches(POOL_SHAPE, { message: "pool must be a pool name" })
  pool!: string;

  @IsString()
  @Matches(REPOSITORY_SHAPE, { message: "repository must be a GitHub owner/name" })
  repository!: string;

  @IsString()
  @MaxLength(256)
  @Matches(REF_SHAPE, { message: "ref must be a git ref with no whitespace" })
  ref!: string;

  @IsString()
  @Matches(COMMIT_SHAPE, { message: "commit must be 40 lower-case hex characters" })
  commit!: string;

  @IsOptional()
  @IsArray()
  @Validate(IsArgv)
  command?: string[];

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  label?: string;
}
