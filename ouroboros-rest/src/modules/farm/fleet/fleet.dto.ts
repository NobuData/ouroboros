/**
 * What the pools card's writes may contain, as `class-validator` classes.
 *
 * AH.6 ([#254](https://github.com/NobuData/ouroboros/issues/254)). `farm.dto.ts`'s position,
 * inherited: **every bound here restates a rule that exists in V040**, and the restatement is
 * not redundancy. The schema is what cannot be bypassed and is therefore the guarantee; these
 * are what turn a violation into a `422` naming the field instead of a `500` naming a
 * constraint an operator has no way to look up.
 *
 * ---------------------------------------------------------------------------
 * **`autoscalePref` is validated and not interpreted, and the two are different jobs.**
 *
 * Decision **B9** makes the preference **inert**: it is stored, returned unchanged, and
 * nothing in this release reads inside it. {@link IsAutoscalePref} therefore restates V040's
 * `farm_autoscale_pref_valid` exactly — the same three keys, the same bounds — and stops
 * there. It does not rename them into camelCase, because the acceptance criterion is that the
 * document comes back *unchanged* and a translation layer over a document nobody acts on is a
 * second place for AJ.1 ([#263](https://github.com/NobuData/ouroboros/issues/263)) to have to
 * agree with.
 *
 * The validation is still worth having for the reason V040's own comment gives: the column is
 * closed *because* nothing reads it yet, so that AJ.1 can activate the preference without
 * first discovering what shapes accumulated while nobody was looking.
 *
 * `!`-asserted rather than initialised, as everywhere in this service.
 */

import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  Validate,
  ValidateIf,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from "class-validator";

import { ARGV_ITEM_MAX_LENGTH, ARGV_MAX_ITEMS, IsArgv } from "../dispatch/jobs.dto";

/** V040's `runner_pools_name_shape`, restated. A slug that may not begin or end in a dash. */
const POOL_SHAPE = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/;

/** The longest a pool name may be — the shape above, stated as a length for a clearer `422`. */
const POOL_NAME_MAX = 64;

/** How long a pool's description may be. The pools card prints it on one line. */
export const DESCRIPTION_MAX = 200;

/** How long a container image reference may be. Registry, path, tag or digest. */
export const IMAGE_MAX = 512;

/** V040's `runner_pools_executor`, restated — decision **B4**'s two worlds. */
export const POOL_EXECUTORS = ["container", "shell"] as const;

/** V040's `runner_pools_max_concurrency_in_range`, restated. */
export const MAX_CONCURRENCY_MIN = 1;
export const MAX_CONCURRENCY_MAX = 64;

/** `farm_text_set_valid(env_allowlist, 64)`'s ceiling, restated. */
export const ENV_ALLOWLIST_MAX = 64;

/** `farm_pool_tags_valid`'s ceiling, restated. */
export const TAGS_MAX = 32;

/** The longest an environment variable name may be. */
const ENV_NAME_MAX = 256;

/** `farm_pool_tags_valid`'s per-tag shape, restated. */
const TAG_SHAPE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/** The three keys `farm_autoscale_pref_valid` permits, and nothing else. */
const AUTOSCALE_KEYS = new Set(["enabled", "queue_threshold", "max_runners"]);

/**
 * A bounded set of distinct, non-empty strings — V040's `farm_text_set_valid`.
 *
 * A **set**, which is the part worth restating: a duplicate is a writer that appended without
 * reading, and it would render twice on the card.
 *
 * @param value - What the field carries.
 * @param max - How many entries are allowed.
 * @param shape - A pattern each entry must match, when the column constrains one.
 * @returns Whether it is a set the column would accept.
 */
function isTextSet(value: unknown, max: number, shape?: RegExp): boolean {
  if (!Array.isArray(value) || value.length > max) return false;
  if (!value.every((item) => typeof item === "string" && item.length > 0)) return false;
  if (shape && !value.every((item: string) => shape.test(item))) return false;

  return new Set(value as string[]).size === value.length;
}

/** `env_allowlist` — up to {@link ENV_ALLOWLIST_MAX} distinct variable names. */
@ValidatorConstraint({ name: "isEnvAllowlist" })
export class IsEnvAllowlist implements ValidatorConstraintInterface {
  /**
   * @param value - What the field carries.
   * @returns Whether the column would accept it.
   */
  validate(value: unknown): boolean {
    return (
      isTextSet(value, ENV_ALLOWLIST_MAX) &&
      (value as string[]).every((name) => name.length <= ENV_NAME_MAX)
    );
  }

  /** @returns What the client is told. */
  defaultMessage(): string {
    return (
      `envAllowlist must be up to ${String(ENV_ALLOWLIST_MAX)} distinct, non-empty variable ` +
      "names"
    );
  }
}

/** `tags` — up to {@link TAGS_MAX} distinct lower-case slugs. */
@ValidatorConstraint({ name: "isPoolTags" })
export class IsPoolTags implements ValidatorConstraintInterface {
  /**
   * @param value - What the field carries.
   * @returns Whether the column would accept it.
   */
  validate(value: unknown): boolean {
    return isTextSet(value, TAGS_MAX, TAG_SHAPE);
  }

  /** @returns What the client is told. */
  defaultMessage(): string {
    return `tags must be up to ${String(TAGS_MAX)} distinct lower-case slugs`;
  }
}

/**
 * `autoscale_pref` — V040's `farm_autoscale_pref_valid`, restated.
 *
 * Closed to three keys, because an unrecognised one is a preference AJ.1 will not honour and
 * an operator would have no way to discover that from a `200`.
 */
@ValidatorConstraint({ name: "isAutoscalePref" })
export class IsAutoscalePref implements ValidatorConstraintInterface {
  /**
   * @param value - What the field carries.
   * @returns Whether the column would accept it.
   */
  validate(value: unknown): boolean {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;

    const pref = value as Record<string, unknown>;
    if (!Object.keys(pref).every((key) => AUTOSCALE_KEYS.has(key))) return false;
    if ("enabled" in pref && typeof pref.enabled !== "boolean") return false;

    return (["queue_threshold", "max_runners"] as const).every(
      (key) => !(key in pref) || (typeof pref[key] === "number" && pref[key] >= 1),
    );
  }

  /** @returns What the client is told. */
  defaultMessage(): string {
    return (
      "autoscalePref may hold only enabled (boolean), queue_threshold and max_runners " +
      "(numbers of at least 1)"
    );
  }
}

/**
 * The columns a pool create and a pool update share.
 *
 * Everything optional, because `PATCH` may name any subset. {@link CreatePoolDto} adds the
 * two a create must have — a pool with no name cannot be referred to and a pool with no
 * executor cannot run anything.
 */
export class PoolFieldsDto {
  /** The line under the name on the card. `null` clears it. */
  @IsOptional()
  @ValidateIf((_body: PoolFieldsDto, value: unknown) => value !== null)
  @IsString()
  @MaxLength(DESCRIPTION_MAX)
  description?: string | null;

  /**
   * The pinned image, for a container pool and **only** for one.
   *
   * V040's `runner_pools_image_for_container` is both directions, and this DTO deliberately
   * does not try to restate that half of it: on a `PATCH` the executor may be unchanged and
   * absent from the body, so whether an image is required cannot be decided from the request
   * alone. `pools.service.ts` decides it against the merged row, which is the only place that
   * knows both halves.
   */
  @IsOptional()
  @ValidateIf((_body: PoolFieldsDto, value: unknown) => value !== null)
  @IsString()
  @MaxLength(IMAGE_MAX)
  image?: string | null;

  /** Variable names a submission may carry into a build of this pool. An allow-list. */
  @IsOptional()
  @IsArray()
  @Validate(IsEnvAllowlist)
  envAllowlist?: string[];

  /** How many builds one runner of this pool may run at once. Per runner, not per pool. */
  @IsOptional()
  @IsInt()
  @Min(MAX_CONCURRENCY_MIN)
  @Max(MAX_CONCURRENCY_MAX)
  maxConcurrency?: number;

  /** The card's switch. A disabled pool takes no new work and keeps what it is running. */
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  /** Queryable pool tags. */
  @IsOptional()
  @IsArray()
  @Validate(IsPoolTags)
  tags?: string[];

  /**
   * What a submission that names no command falls back to, as argv.
   *
   * **argv, never a shell string** — `dispatch/jobs.dto.ts`'s rule, and the same validator, so
   * a pool's default and a submission's command are bounded identically. Stored as
   * `command.ts`'s canonical rendering, which is the form `build_jobs.command` holds. `null`
   * clears it, which makes every submission to this pool name its own.
   */
  @IsOptional()
  @ValidateIf((_body: PoolFieldsDto, value: unknown) => value !== null)
  @IsArray()
  @Validate(IsArgv)
  @Type(() => String)
  defaultCommand?: string[] | null;

  /**
   * The mockup's *"Auto-scale to cloud when queue > 5"* — stored and **inert** (decision B9).
   *
   * Its keys are the database's, unchanged. See this file's header.
   */
  @IsOptional()
  @Validate(IsAutoscalePref)
  autoscalePref?: Record<string, unknown>;
}

/** The body of `POST /api/v1/farm/pools`. */
export class CreatePoolDto extends PoolFieldsDto {
  /** The name `--pool` passes and a submission selects by. Unique per workspace. */
  @IsString()
  @MaxLength(POOL_NAME_MAX)
  @Matches(POOL_SHAPE, { message: "name must be a lower-case slug" })
  name!: string;

  /** `container` or `shell` — decision **B4**. Snapshotted onto every build of this pool. */
  @IsIn([...POOL_EXECUTORS])
  executor!: (typeof POOL_EXECUTORS)[number];
}

/**
 * The body of `PATCH /api/v1/farm/pools/{id}`.
 *
 * `name` and `executor` are optional here and required on a create, which is the whole of the
 * difference. Changing `executor` is permitted and is a real decision: the column is
 * snapshotted onto every job at submission, so editing a pool changes what its *next* builds
 * run under and rewrites nothing that already ran — V040's reason for the snapshot.
 */
export class UpdatePoolDto extends PoolFieldsDto {
  /** A new name. Still unique per workspace, and still what `--pool` will have to say. */
  @IsOptional()
  @IsString()
  @MaxLength(POOL_NAME_MAX)
  @Matches(POOL_SHAPE, { message: "name must be a lower-case slug" })
  name?: string;

  /** A new executor. What the pool's next builds run under. */
  @IsOptional()
  @IsIn([...POOL_EXECUTORS])
  executor?: (typeof POOL_EXECUTORS)[number];
}

/** The query of `GET /api/v1/farm/enroll-command`. */
export class EnrollCommandQuery {
  /** The pool the enrolled machine joins — the command's `--pool`. */
  @IsString()
  @MaxLength(POOL_NAME_MAX)
  @Matches(POOL_SHAPE, { message: "pool must be a lower-case slug" })
  pool!: string;
}

/** Re-exported so a pool's default command and a submission's are bounded by one pair. */
export { ARGV_ITEM_MAX_LENGTH, ARGV_MAX_ITEMS };
