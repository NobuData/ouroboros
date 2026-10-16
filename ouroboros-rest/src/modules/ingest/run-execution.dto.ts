/**
 * The bodies of the four execution routes under `/internal/runs/:id` — #160's bridge between the
 * engine's interpreter and a run (ADR decision A: an epoch-fenced start, a heartbeat, a durable
 * checkpoint and a keyed finish).
 *
 * **Spelled in snake_case**, unlike the six AP.1 reports beside them: these four are the contract
 * the engine's interpreter and this service were built to together (#160), and that contract
 * names its fields the way the engine's Python names them. The epoch on the AP.1 reports is one
 * word, so the two spellings never meet in one body.
 *
 * Every refusal of a malformed body is the global pipe's `422 validation_failed`, as on the rest
 * of this surface.
 */

import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateBy,
  type ValidationOptions,
} from "class-validator";

import { MAX_EXEC_EPOCH, MAX_IDEMPOTENCY_KEY_LENGTH, STAGE_KEY_PATTERN } from "./ingest.dto";

/** The largest checkpoint state, in bytes as PostgreSQL renders it — V147's 64 KiB. */
export const MAX_CHECKPOINT_BYTES = 65_536;

/** The longest finish reason. */
export const MAX_FINISH_REASON_LENGTH = 500;

/** A base commit: forty lower-case hex digits, as V147's `runs_exec_base_commit_shape` holds. */
export const BASE_COMMIT_PATTERN = /^[0-9a-f]{40}$/;

/** How a run may end through `/finish` — each maps to one `runs.status` (#160). */
export const FINISH_OUTCOMES = ["review", "needs_human", "failed", "back_to_queue"] as const;

/** One of {@link FINISH_OUTCOMES}. */
export type FinishOutcome = (typeof FINISH_OUTCOMES)[number];

/**
 * How many bytes a JSON value takes in PostgreSQL's `jsonb` text rendering — what V147's
 * `octet_length(exec_checkpoint::text)` measures.
 *
 * `jsonb` renders `", "` between elements and `": "` after a key, where `JSON.stringify` writes
 * neither space, so the compact length would undercount and let a state through that the
 * database then refuses as a `500`. Strings and numbers are rendered as `JSON.stringify` does.
 *
 * @param value - A JSON value.
 * @returns Its rendered size in UTF-8 bytes.
 */
export function jsonbTextBytes(value: unknown): number {
  return Buffer.byteLength(jsonbText(value), "utf8");
}

/**
 * Render a JSON value the way `jsonb::text` spaces it.
 *
 * @param value - A JSON value.
 * @returns The text.
 */
function jsonbText(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(jsonbText).join(", ")}]`;
  }

  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, inner]) => inner !== undefined)
      .map(([key, inner]) => `${JSON.stringify(key)}: ${jsonbText(inner)}`);

    return `{${entries.join(", ")}}`;
  }

  return JSON.stringify(value) ?? "null";
}

/**
 * Validates that a JSON object renders within a byte budget in `jsonb` text.
 *
 * @param maximum - The largest size, in bytes.
 * @param options - class-validator's options.
 * @returns The property decorator.
 */
export function MaxJsonbBytes(maximum: number, options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: "maxJsonbBytes",
      constraints: [maximum],
      validator: {
        validate: (value: unknown) => jsonbTextBytes(value) <= maximum,
        defaultMessage: () => `$property must be at most ${String(maximum)} bytes as JSON`,
      },
    },
    options,
  );
}

/** `POST /internal/runs/:id/start` — take the run, and everything executing it needs. */
export class StartRunDto {
  /** The worker starting it, as it names itself — the shape of `queue_items.claimed_by`. */
  @Matches(/^\S(.*\S)?$/, { message: "worker must not be empty or padded with whitespace" })
  @MaxLength(128)
  @IsString()
  worker!: string;
}

/** What every write after the start carries: the epoch the start answered. */
export abstract class EpochRequestDto {
  /** `runs.exec_epoch`, as the start answered it. A different one is `409 fenced`. */
  @Max(MAX_EXEC_EPOCH)
  @Min(1)
  @IsInt()
  epoch!: number;
}

/** `POST /internal/runs/:id/heartbeat` — the worker is still executing the run. */
export class HeartbeatDto extends EpochRequestDto {}

/** `PUT /internal/runs/:id/checkpoint` — save the interpreter's resume state. */
export class CheckpointRunDto extends EpochRequestDto {
  /**
   * The commit the run's working tree was cut from — sent once, on the first checkpoint, and
   * refused `409 base_commit_mismatch` if it later names another.
   */
  @Matches(BASE_COMMIT_PATTERN, { message: "base_commit must be forty lower-case hex digits" })
  @IsString()
  @IsOptional()
  base_commit?: string;

  /** The interpreter's opaque state — a JSON object, at most 64 KiB as PostgreSQL renders it. */
  @MaxJsonbBytes(MAX_CHECKPOINT_BYTES)
  @IsObject()
  state!: Record<string, unknown>;
}

/** `POST /internal/runs/:id/finish` — end the run through one of the workflow's terminals. */
export class FinishRunDto extends EpochRequestDto {
  /**
   * The caller's name for this submission — replaying it answers what the first delivery was
   * told; presenting it with a different body is `409 idempotency_key_reused`.
   */
  @Matches(/^\S(.*\S)?$/, {
    message: "idempotency_key must not be empty or padded with whitespace",
  })
  @MaxLength(MAX_IDEMPOTENCY_KEY_LENGTH)
  @MinLength(1)
  @IsString()
  idempotency_key!: string;

  /** Where the run goes. */
  @IsIn(FINISH_OUTCOMES)
  outcome!: FinishOutcome;

  /** Why, in a sentence — kept on the transcript and, for `needs_human`, on the inbox card. */
  @MaxLength(MAX_FINISH_REASON_LENGTH)
  @MinLength(1)
  @IsString()
  reason!: string;

  /** The DSL node the run ended at, when there is one. */
  @Matches(STAGE_KEY_PATTERN, { message: "stage_key must be a DSL node id" })
  @MaxLength(64)
  @IsString()
  @IsOptional()
  stage_key?: string;
}
