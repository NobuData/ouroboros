/**
 * `POST /api/v1/inbox/items/{id}/actions/{actionId}` — the route's parameters and body, as
 * `class-validator` classes (BN.2, [#462](https://github.com/NobuData/ouroboros/issues/462)).
 */

import { IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from "class-validator";

import { MAX_IDEMPOTENCY_KEY_LENGTH } from "../ingest/ingest.dto";

/** The longest note a resolution stores (V095's `decision_resolutions_note_bounded`). */
export const MAX_NOTE_LENGTH = 2000;

/** A value with no leading or trailing whitespace. */
const TRIMMED = /^\S(.*\S)?$/s;

/** The decision action grammar V099 holds `action_id` to. */
const ACTION_ID = /^[a-z][a-z0-9_]{0,62}$/;

/** The item and the action. */
export class InboxActionParams {
  /** `decision_items.id`. */
  @IsUUID()
  id!: string;

  /** A declared action of the item's pinned kind — `approve_merge`, `allow_once`. */
  @Matches(ACTION_ID, { message: "actionId must be a declared action id" })
  actionId!: string;
}

/** The press. */
export class InboxActionDto {
  /**
   * The note: the return-to-loop steering, the waiver's reason, the retirement's why. Required
   * exactly when the action declares `takes_note` (`422 decision_note_required` /
   * `decision_note_not_taken`).
   */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_NOTE_LENGTH)
  note?: string;

  /**
   * The caller's name for this press. A client that retries a request whose response it lost
   * sends the same key and is answered with the first attempt's outcome — the action never runs
   * twice. Optional: the executor generates one.
   */
  @IsOptional()
  @Matches(TRIMMED, { message: "idempotencyKey must not be empty or padded with whitespace" })
  @MaxLength(MAX_IDEMPOTENCY_KEY_LENGTH)
  @MinLength(1)
  @IsString()
  idempotencyKey?: string;
}
