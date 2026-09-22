/**
 * What a control request may contain — the public submission and the executor's
 * acknowledgment, as `class-validator` classes (AP.4,
 * [#306](https://github.com/NobuData/ouroboros/issues/306)).
 *
 * The bounds restate V048's constraints (`run_controls_payload_shape`, `…_idempotency_key_shape`,
 * `…_ack_detail_belongs_to_outcome`), so a caller gets a `422` naming the field rather than a
 * `500` naming a constraint. Rules that depend on the kind, such as *only a steer carries text*,
 * are the service's, because a validator decorator sees one field at a time.
 */

import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

import { RUN_CONTROL_KINDS, type RunControlKind } from "../db/schema";
import { MAX_IDEMPOTENCY_KEY_LENGTH } from "../ingest/ingest.dto";

/** The longest steer — 4096, `run_controls_payload_shape`. */
export const MAX_STEER_LENGTH = 4096;

/** The longest ack detail — 1024, `run_controls_ack_detail_belongs_to_outcome`. */
export const MAX_ACK_DETAIL_LENGTH = 1024;

/** The longest typed confirmation — a loop number, with room for a `#` and some whitespace. */
export const MAX_CONFIRMATION_LENGTH = 32;

/** The highest attempt an ack may name — the DSL's retry ceiling is far below it. */
export const MAX_ATTEMPT = 1000;

/** Trimmed and non-empty, which is what V048 asks of a key and a detail. */
const TRIMMED = /^\S(.*\S)?$/s;

/** The path of `POST`/`GET /api/v1/runs/{id}/controls`. */
export class RunControlsParams {
  /** `runs.id`, a uuid (V008). Anything else is a `422`, not a probe's `404`. */
  @IsUUID()
  id!: string;
}

/** The path of `POST /internal/runs/{id}/controls/{controlId}/ack`. */
export class ControlAckParams extends RunControlsParams {
  /** `run_controls.id`, a uuid (V048). */
  @IsUUID()
  controlId!: string;
}

/**
 * `POST /api/v1/runs/{id}/controls` — somebody pressing a button, or typing into the box.
 */
export class SubmitControlDto {
  /** Which control. The role it needs is `controls.policy.ts`'s `CONTROL_ROLES`. */
  @IsIn(RUN_CONTROL_KINDS)
  kind!: RunControlKind;

  /**
   * The steering text. Required for a steer and refused on every other kind, which the service
   * checks, because it depends on `kind`.
   */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_STEER_LENGTH)
  payload?: string;

  /**
   * The steer's *remember this* flag (the #412 amendment). Only a flagged steer becomes a fact
   * candidate, and the candidate still waits for review. Refused on every other kind.
   */
  @IsOptional()
  @IsBoolean()
  remember?: boolean;

  /**
   * What the person typed into the abort dialog: the loop number. Re-checked against the run
   * by the server. Ignored for every other kind.
   */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_CONFIRMATION_LENGTH)
  confirmation?: string;

  /**
   * The caller's name for this submission. Optional: a person pressing a button once needs
   * none, and the database gives the row a fresh one. A client that retries a request whose
   * response it lost sends the same key and is answered with the same control.
   */
  @IsOptional()
  @Matches(TRIMMED, { message: "idempotencyKey must not be empty or padded with whitespace" })
  @MaxLength(MAX_IDEMPOTENCY_KEY_LENGTH)
  @MinLength(1)
  @IsString()
  idempotencyKey?: string;
}

/**
 * `POST /internal/runs/{id}/controls/{controlId}/ack` — the executor saying what it did.
 */
export class AckControlDto {
  /**
   * The effect, in the executor's words: *"paused at the top of the loop"*. Optional; without
   * it the service records the kind's default sentence (`controls.policy.ts`).
   */
  @IsOptional()
  @Matches(TRIMMED, { message: "effect must not be empty or padded with whitespace" })
  @MaxLength(MAX_ACK_DETAIL_LENGTH)
  @IsString()
  effect?: string;

  /**
   * The attempt a steer was applied to — the `2` of *"steering applied to attempt 2"*. Used
   * only to compose the default sentence when `effect` is absent.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_ATTEMPT)
  attempt?: number;
}
