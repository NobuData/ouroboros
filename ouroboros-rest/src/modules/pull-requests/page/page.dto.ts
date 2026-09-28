/**
 * What the PR page's reads and head actions accept — AX.5
 * ([#361](https://github.com/NobuData/ouroboros/issues/361)).
 *
 * The path is the criteria routes' {@link PullRequestParams}. The bounds restate V065's
 * constraints (`pr_approvals_note_bounded`, `pr_approvals_host_reviewer_shape`,
 * `pr_loop_return_gate_keys_valid`) and AP.4's steer limits, so a caller gets a `422` naming the
 * field rather than a `500` naming a constraint. Whether a gate is *red* is the service's, because
 * only a read can say.
 */

import { Transform } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

import { labelList } from "../../backlog/listing.dto";
import { PULL_REQUEST_STATES, type PullRequestState } from "../../db/schema";
import { MAX_IDEMPOTENCY_KEY_LENGTH } from "../../ingest/ingest.dto";
import { PageQuery } from "../../tenancy/pagination";

import { PullRequestParams } from "../criteria/criteria.dto";

export { PullRequestParams };

/** V065's `pr_approvals_note_bounded` — at most 2000. */
export const MAX_APPROVAL_NOTE_LENGTH = 2000;

/** V065's `pr_approvals_host_reviewer_shape` — at most 255. */
export const MAX_HOST_REVIEWER_LENGTH = 255;

/** The most gates one return sends back — V065's `pr_loop_return_gate_keys_valid`. */
export const MAX_RETURNED_GATES = 64;

/** The longest note a return carries; the steer's own limit shortens it further if it must. */
export const MAX_RETURN_NOTE_LENGTH = 1024;

/** V057's `pr_thread_entries_resolution_when_resolved` — a resolving reply is at most 8192. */
export const MAX_THREAD_REPLY_LENGTH = 8192;

/** The most runs one listing narrows to — the page size's own ceiling. */
export const MAX_LISTED_RUN_IDS = 100;

/** V056's gate key: a built-in key or `custom:<name>`. */
export const GATE_KEY_PATTERN =
  /^(build|test_suite|physical_hil|diff_vs_plan|secrets_license|model_review|human_approval|custom:[a-z0-9][a-z0-9_.-]{0,62})$/;

/** Not empty, and not padded — the rule AP.4's DTOs hold free text to. */
const TRIMMED = /^\S(.*\S)?$/s;

/**
 * Read a query-string boolean — `true` and `false` only; anything else is left for `@IsBoolean`
 * to refuse with a `422`.
 *
 * @param value - The raw value.
 * @returns The boolean, or the value untouched.
 */
export function queryBoolean(value: unknown): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

/** The query string of `GET /api/v1/pull-requests`. */
export class ListPullRequestsQuery extends PageQuery {
  /**
   * Narrow to these states — `?state=verifying,blocked` or the parameter repeated. Absent is every
   * state.
   */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => labelList(value))
  @IsIn(PULL_REQUEST_STATES, { each: true })
  state?: PullRequestState[];

  /**
   * `true` — only PRs with an open approval slot: the needs-you feed. `false` — only PRs without
   * one. Absent is both.
   */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => queryBoolean(value))
  @IsBoolean()
  reviewRequested?: boolean;

  /**
   * Only the PRs these runs opened — `?runId=<uuid>,<uuid>` or the parameter repeated. How a
   * surface that holds runs and not PRs (the run console, test results, the dashboard's rows)
   * finds the PR page ([#363](https://github.com/NobuData/ouroboros/issues/363)). A run of
   * another workspace, or one that opened no PR, contributes no row. Absent is every run.
   */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => labelList(value))
  @ArrayMaxSize(MAX_LISTED_RUN_IDS)
  @IsUUID("all", { each: true })
  runId?: string[];
}

/** `POST /api/v1/pull-requests/{id}/return-to-loop`. */
export class ReturnToLoopDto {
  /**
   * The red gates whose evidence the steer carries — gate keys, each once. Each must be red on the
   * revision (`422 pr_gate_not_red`).
   */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_RETURNED_GATES)
  @ArrayUnique()
  @Matches(GATE_KEY_PATTERN, { each: true, message: "each gate must be a gate key" })
  @IsString({ each: true })
  gates!: string[];

  /**
   * The revision whose gates the person selected — `pr_revisions.id`. Defaults to the latest; the
   * UI can scope the gates card to an earlier revision's snapshot and return from there.
   */
  @IsOptional()
  @IsUUID()
  revisionId?: string;

  /** An instruction to append after the evidence, as `note: …`. */
  @IsOptional()
  @Matches(TRIMMED, { message: "note must not be empty or padded with whitespace" })
  @MaxLength(MAX_RETURN_NOTE_LENGTH)
  @IsString()
  note?: string;

  /** Optional: a replay with the same key answers the first control (AP.4's rule). */
  @IsOptional()
  @Matches(TRIMMED, { message: "idempotencyKey must not be empty or padded with whitespace" })
  @MaxLength(MAX_IDEMPOTENCY_KEY_LENGTH)
  @MinLength(1)
  @IsString()
  idempotencyKey?: string;
}

/** `POST /api/v1/pull-requests/{id}/request-review`. */
export class RequestReviewDto {
  /**
   * Optional: a git-host login to ask on the PR itself (SPI `requestReview`). A host refusal is
   * recorded on the slot, never thrown.
   */
  @IsOptional()
  @Matches(TRIMMED, { message: "reviewer must not be empty or padded with whitespace" })
  @MaxLength(MAX_HOST_REVIEWER_LENGTH)
  @IsString()
  reviewer?: string;
}

/** The two answers an approval slot takes. */
export const APPROVAL_DECISIONS = ["approve", "decline"] as const;

/** One of {@link APPROVAL_DECISIONS}. */
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

/** `POST /api/v1/pull-requests/{id}/approvals`. */
export class ApprovalDecisionDto {
  /** `approve` — the gate goes green; `decline` — it goes red, and needs a note. */
  @IsIn(APPROVAL_DECISIONS)
  decision!: ApprovalDecision;

  /** Why — optional on an approve, required on a decline (`422 pr_decline_note_required`). */
  @IsOptional()
  @Matches(TRIMMED, { message: "note must not be empty or padded with whitespace" })
  @MaxLength(MAX_APPROVAL_NOTE_LENGTH)
  @IsString()
  note?: string;
}

/** The path of `/api/v1/pull-requests/{id}/thread/{entryId}…`. */
export class ThreadEntryParams extends PullRequestParams {
  /** `pr_thread_entries.id`, a uuid (V057). */
  @IsUUID()
  entryId!: string;
}

/** `POST /api/v1/pull-requests/{id}/thread/{entryId}/resolve`. */
export class ResolveThreadEntryDto {
  /** The resolving reply — *Addressed in attempt 4 — …*. Optional: an entry may simply be resolved. */
  @IsOptional()
  @Matches(TRIMMED, { message: "reply must not be empty or padded with whitespace" })
  @MaxLength(MAX_THREAD_REPLY_LENGTH)
  @IsString()
  reply?: string;

  /**
   * `true` — also post the reply to the host PR as a comment. Needs a reply
   * (`422 pr_thread_mirror_needs_reply`). A host refusal is answered, never thrown.
   */
  @IsOptional()
  @IsBoolean()
  mirror?: boolean;
}
