/**
 * What an executor may send — the six request bodies of the ingestion contract, as
 * `class-validator` classes.
 *
 * AP.1 ([#303](https://github.com/NobuData/ouroboros/issues/303)), decision **R2**. These
 * classes are the contract's *shape*; `openapi.internal.yaml` is its published description and
 * `openapi.spec.ts` holds the two together. The global pipe's `whitelist` and
 * `forbidNonWhitelisted` apply, so a body carrying a field this surface does not define is
 * refused with `422` rather than quietly ignored — which matters more here than on a browser
 * route, because a worker sending an unknown field is a worker built against a different
 * version of the contract and finding out immediately is cheaper than finding out through
 * behaviour.
 *
 * ---------------------------------------------------------------------------
 * **Four fields that are absent on purpose, and each absence is a decision.**
 *
 *   1. **No `note` on a stage transition.** The issue: *"a gate-return transition composes
 *      the note rather than accepting note text"*. V045 makes `run_stages.note` a
 *      `GENERATED ALWAYS … STORED` column over the attempt and the three transition columns,
 *      so PostgreSQL refuses any statement that supplies one. Declaring the field here would
 *      publish a contract the database cannot honour — the refusal would be a `500` naming a
 *      constraint instead of a `422` naming a field, which is the wrong end of the failure.
 *   2. **No `simulated` anywhere.** *"`simulated` cannot be cleared by a client claim; it
 *      follows the principal"* — see `internal.principal.ts`. A field would make it a claim
 *      by definition, however carefully the service then ignored it.
 *   3. **No `seq` on an event.** V046's `run_events_append()` allocates it densely, which is
 *      what AP.2's `?after=` pages by. What an executor sends instead is a {@link
 *      IngestEventDto.hint} — its own ordering, which the server checks and does not adopt.
 *   4. **No `organizationId` anywhere.** The workspace is resolved from a row the caller
 *      named — the ticket a run opens for, the run everything else is reported against — and
 *      never from the request. AD.3's rule for this channel: a worker naming its own
 *      workspace is a worker choosing whose ledger to write into.
 *
 * ---------------------------------------------------------------------------
 * **Every body carries `idempotencyKey`, and it is required.** V048's `run_controls` defaults
 * one because a control may legitimately be a one-off a human pressed. An executor's report
 * never is: it is a thing that can be redelivered, and a report that arrived without a name
 * is one nothing can recognise on its second delivery.
 */

import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";

import {
  RUN_EVENT_ACTORS,
  RUN_FILE_STATUSES,
  RUN_MERGE_STRATEGIES,
  RUN_STAGE_RETURN_KINDS,
  RUN_STAGE_RETURN_REASONS,
  RUN_STAGE_STATUSES,
  type RunEventActor,
  type RunFileStatus,
  type RunMergeStrategy,
  type RunStageReturnKind,
  type RunStageReturnReason,
  type RunStageStatus,
} from "../db/schema";

/**
 * The longest idempotency key — 128, matching `run_ingest_receipts_idempotency_key_shape` and
 * V048's `run_controls.idempotency_key`.
 *
 * One bound for both, because they are the same kind of thing and a caller should not have to
 * hold two rules. Comfortably a uuid, a ULID, or a composite an executor builds from a run and
 * a counter.
 */
export const MAX_IDEMPOTENCY_KEY_LENGTH = 128;

/**
 * How many transcript entries one `POST …/events` may carry — 500.
 *
 * A bound on the *request*, not on the transcript: V046's per-run caps are what bound the
 * transcript, and they are columns so a test can set one low enough to watch it work. This
 * exists for the other failure — one enormous body holding a run's whole output, parsed into
 * memory before a single row is written. Five hundred typed entries is a comfortable multiple
 * of anything a stage produces between reports and well inside what one transaction should
 * hold.
 */
export const MAX_EVENTS_PER_BATCH = 500;

/**
 * How many files one change-set report may carry — 2000.
 *
 * The report is *cumulative* — it is the whole change-set, not the delta — so this is a bound
 * on how large a change-set a run may have rather than on how often it may report. Two
 * thousand files is a refactor nobody should be merging and several times the largest
 * change-set the Changes card could render; a run past it is one whose report is a mistake.
 */
export const MAX_FILES_PER_REPORT = 2000;

/** How many commits one `POST …/commits` may carry — 200. */
export const MAX_COMMITS_PER_REPORT = 200;

/** The longest file path — 1024, matching `run_files_path_present`. */
export const MAX_PATH_LENGTH = 1024;

/** The longest commit message — 8192, matching `run_commits_message_present`. */
export const MAX_COMMIT_MESSAGE_LENGTH = 8192;

/** The longest transcript body — 20000, which is a paragraph of model output and not a file. */
export const MAX_EVENT_BODY_LENGTH = 20_000;

/** A git object name, abbreviated or whole — `run_commits_sha_shape`. */
export const SHA_PATTERN = /^[0-9a-f]{7,40}$/;

/** A DSL node id, as `run_stages_stage_key_slug` and `NodeIdSchema` both spell it. */
export const STAGE_KEY_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/** A tool tag — `run_events_tool_tag_shape`. Underscores rather than hyphens, as V046 has it. */
export const TOOL_TAG_PATTERN = /^[a-z0-9]([a-z0-9_]*[a-z0-9])?$/;

/**
 * `:id` — the run every report but the first is addressed to.
 *
 * A validated class rather than `@Param("id", ParseUUIDPipe)`, which is the other pattern in
 * this service and answers `400`. Every other refusal of a malformed request on this surface
 * is the global pipe's `422 validation_failed`, and an executor that had to branch on two
 * statuses for *"your request is the wrong shape"* would be branching on which decorator a
 * handler happened to use.
 */
export class RunIdParams {
  /** `runs.id`. */
  @IsUUID()
  id!: string;
}

/**
 * What every body carries.
 *
 * A base class rather than a repeated field, so *"every write on this surface is
 * idempotency-keyed"* is a structural fact about the contract instead of six independent
 * decisions that happen to agree.
 */
export abstract class IdempotentRequestDto {
  /**
   * The caller's name for this submission.
   *
   * Replaying it returns the original result; presenting it with a different body is refused
   * with `idempotency_key_reused`. Trimmed-and-non-empty is asserted by the database
   * (`run_ingest_receipts_idempotency_key_shape`) and here, so the caller gets a `422` naming
   * the field rather than a `500` naming a constraint.
   */
  @Matches(/^\S(.*\S)?$/, {
    message: "idempotencyKey must not be empty or padded with whitespace",
  })
  @MaxLength(MAX_IDEMPOTENCY_KEY_LENGTH)
  @MinLength(1)
  @IsString()
  idempotencyKey!: string;
}

/**
 * Which ticket a run is opened for — the canonical linkage the issue names.
 *
 * *"ticket linkage via the canonical `external_key`"*: a run is opened for a **ticket**, in
 * V030's source-neutral model, rather than for a GitHub issue number. The source is named by
 * id because `external_key` is deliberately not unique across sources — V030: *"two sources
 * may hold the same key, and the acceptance criterion requires it"* — so the pair is what
 * identifies one.
 *
 * Within a source a key *should* be unique and is not guaranteed to be; a key matching twice
 * is refused with `ticket_ambiguous` rather than resolved by sorting.
 */
export class TicketReferenceDto {
  /** `ticket_sources.id` — and the row the run's workspace is resolved from. */
  @IsUUID()
  source!: string;

  /** `tickets.external_key` — the display form: `#482`, `PROJ-142`, `ENG-123`. */
  @MaxLength(128)
  @MinLength(1)
  @IsString()
  externalKey!: string;
}

/** Which workflow version a run pins. */
export class WorkflowPinDto {
  /** `workflows.slug` — the `standard-fix` half of the head's `standard-fix v14` tag. */
  @MaxLength(64)
  @MinLength(1)
  @IsString()
  tag!: string;

  /**
   * `workflow_versions.version` — the `v14` half.
   *
   * Required. A run with no pin is a run that cannot answer *"what did it actually run
   * under?"*, and every stage fact this contract later derives comes from the pinned
   * document. `runs.workflow_version_pin` is nullable because V008's rows predate pinning,
   * not because a new run may skip it.
   */
  @Max(1_000_000)
  @Min(1)
  @IsInt()
  version!: number;
}

/** `POST /internal/runs` — open a run. */
export class OpenRunDto extends IdempotentRequestDto {
  /**
   * The ticket, which is also where the workspace comes from.
   *
   * `@IsObject()` beside `@ValidateNested()` on every required nested field here, and it is
   * load-bearing rather than belt-and-braces: `@ValidateNested()` validates a value that is
   * there and says nothing about one that is not, so without it a body omitting `ticket`
   * would pass the pipe and reach a service that then reads a property of `undefined`.
   */
  @IsObject()
  @ValidateNested()
  @Type(() => TicketReferenceDto)
  ticket!: TicketReferenceDto;

  /**
   * `github_repos.id` — the repository the branch lives in.
   *
   * Named explicitly rather than dug out of `tickets.meta`, whose GitHub shape V030 records
   * as a *mapping* rather than as a contract. Validated against the ticket's workspace, so a
   * mistyped id is `repository_not_found` rather than a run attached to somebody else's
   * repository.
   */
  @IsUUID()
  repository!: string;

  /** The workflow version this run is pinned to, snapshotted at this moment. */
  @IsObject()
  @ValidateNested()
  @Type(() => WorkflowPinDto)
  workflow!: WorkflowPinDto;

  /** The model the run is attributed to — `runs.model`, what mockup 02's row renders. */
  @MaxLength(200)
  @MinLength(1)
  @IsString()
  model!: string;

  /**
   * The branch the loop works on — `loop/482-canbus-flake`.
   *
   * Optional, because a run may open before it has one. `runs_branch_name_present` bounds it
   * at 255 and refuses padding.
   */
  @Matches(/^\S(.*\S)?$/, { message: "branchName must not be empty or padded with whitespace" })
  @MaxLength(255)
  @IsString()
  @IsOptional()
  branchName?: string;

  /** How the pinned terminal merges — the Changes card's *will squash on merge* tag. */
  @IsIn(RUN_MERGE_STRATEGIES)
  @IsOptional()
  mergeStrategy?: RunMergeStrategy;
}

/**
 * Where a loop edge brought a run back from — the three columns V045 composes a note out of.
 *
 * All three or none: `run_stages_return_complete`. That is why they are one object rather than
 * three optional fields, which would make *two of the three* a shape the contract publishes
 * and the database refuses.
 */
export class StageReturnDto {
  /** The DSL node id the loop edge left from — `checks-green`. */
  @Matches(STAGE_KEY_PATTERN, { message: "stageKey must be a DSL node id" })
  @MaxLength(64)
  @IsString()
  stageKey!: string;

  /**
   * What kind of node that was.
   *
   * Sent rather than derived from the pin, deliberately: the note is a record of a
   * *transition*, and the executor is what observed it. Refusing to take the executor's word
   * here would mean composing the sentence from a document that may have been republished
   * since — and the kind the note prints has to be the kind the run actually came back from.
   */
  @IsIn(RUN_STAGE_RETURN_KINDS)
  kind!: RunStageReturnKind;

  /**
   * How the previous attempt ended, from V045's closed set.
   *
   * Closed because `run_stages.note` maps each word to a phrase, and a word with no phrase
   * would compose a sentence with a hole in it.
   */
  @IsIn(RUN_STAGE_RETURN_REASONS)
  reason!: RunStageReturnReason;
}

/** `POST /internal/runs/:id/stage-transitions` — move one stage attempt. */
export class StageTransitionDto extends IdempotentRequestDto {
  /** The DSL node id — resolved against the run's pin for its label, position and limits. */
  @Matches(STAGE_KEY_PATTERN, { message: "stageKey must be a DSL node id" })
  @MaxLength(64)
  @IsString()
  stageKey!: string;

  /** Where the transition takes the attempt. */
  @IsIn(RUN_STAGE_STATUSES)
  status!: RunStageStatus;

  /**
   * Which attempt — the `2` of *attempt 2/3*.
   *
   * Optional, and its default is *the attempt that exists*: 1 for a stage with no rows, and
   * the highest one otherwise. An executor reporting a retry says so by naming the number,
   * which is the one case where guessing would be wrong — and V045's
   * `run_stages_attempt_sequence()` still refuses an attempt whose predecessor has not ended.
   */
  @Max(11)
  @Min(1)
  @IsInt()
  @IsOptional()
  attempt?: number;

  /**
   * When it happened, by the executor's clock.
   *
   * Optional; the server's `now()` otherwise. Sent because an executor that batched a report
   * knows when the stage actually turned, and a stepper whose durations are measured from
   * *when the report arrived* would attribute network time to the stage.
   */
  @IsISO8601({ strict: true })
  @IsOptional()
  at?: string;

  /** The loop edge this attempt came back through, when it is a gate return. */
  @IsObject()
  @ValidateNested()
  @Type(() => StageReturnDto)
  @IsOptional()
  returnedFrom?: StageReturnDto;
}

/** One transcript entry, as an executor reports it. */
export class IngestEventDto {
  /**
   * The executor's own ordering number for this entry.
   *
   * Monotonic within a run and strictly increasing within a batch. The server checks it
   * against `runs.event_hint` and **does not adopt it**: `run_events.seq` is allocated densely
   * by V046's trigger, because that is the sequence AP.2's `?after=` pages by and an
   * executor-chosen one would have gaps wherever a cap refused an entry.
   */
  @Max(2_147_483_647)
  @Min(1)
  @IsInt()
  hint!: number;

  /** Who is speaking — the chip mockup 10's transcript draws. */
  @IsIn(RUN_EVENT_ACTORS)
  actor!: RunEventActor;

  /** When, by the executor's clock. The server's `now()` when absent. */
  @IsISO8601({ strict: true })
  @IsOptional()
  ts?: string;

  /** The stage this happened under. Paired with {@link IngestEventDto.attempt} by V046. */
  @Matches(STAGE_KEY_PATTERN, { message: "stageKey must be a DSL node id" })
  @MaxLength(64)
  @IsString()
  @IsOptional()
  stageKey?: string;

  /** Which attempt of it. */
  @Max(11)
  @Min(1)
  @IsInt()
  @IsOptional()
  attempt?: number;

  /** The tool, for a `tool` entry — `run_events_tool_tag_is_a_tool` refuses it on any other. */
  @Matches(TOOL_TAG_PATTERN, { message: "toolTag must be a lower-case tool name" })
  @MaxLength(64)
  @IsString()
  @IsOptional()
  toolTag?: string;

  /** Which model said it, for a `model` entry — required on one by `run_events_model_provenance`. */
  @Matches(/^\S(.*\S)?$/, { message: "modelId must not be empty or padded with whitespace" })
  @MaxLength(200)
  @IsString()
  @IsOptional()
  modelId?: string;

  /** The prose. Null-or-payload: `run_events_says_something` requires one of the two. */
  @MaxLength(MAX_EVENT_BODY_LENGTH)
  @MinLength(1)
  @IsString()
  @IsOptional()
  body?: string;

  /**
   * The structure — diff hunks, a progress fraction, a tool result.
   *
   * Left open here and constrained by the database: V046 requires an object, types a `hunks`
   * key to `{kind, text}` with `kind` in `ctx | del | add`, and says nothing about the rest.
   * Re-stating that shape in a validator would be a second definition of a rule the store
   * already enforces, and the two would drift.
   */
  @IsOptional()
  payload?: Record<string, unknown>;
}

/** `POST /internal/runs/:id/events` — append to the transcript. */
export class IngestEventsDto extends IdempotentRequestDto {
  /**
   * The batch, in the executor's own order.
   *
   * At least one: an empty batch is a request nobody meant to send, and answering it `200`
   * would let a broken client believe it had reported something.
   */
  @ValidateNested({ each: true })
  @Type(() => IngestEventDto)
  @ArrayMaxSize(MAX_EVENTS_PER_BATCH)
  @ArrayMinSize(1)
  @IsArray()
  events!: IngestEventDto[];
}

/** One file of a change-set, as it stands now. */
export class IngestFileDto {
  /**
   * The path, relative to the repository root.
   *
   * `run_files_path_is_relative` refuses a leading `/` and any `..` segment — AO.4's
   * allowed-paths guardrail matches globs against this value, and a path that could climb out
   * of the tree would be a path a glob cannot reason about.
   */
  @Matches(/^(?!\/)(?!.*(^|\/)\.\.(\/|$)).*$/, {
    message: "path must be relative and must not contain a .. segment",
  })
  @Matches(/^\S(.*\S)?$/, { message: "path must not be empty or padded with whitespace" })
  @MaxLength(MAX_PATH_LENGTH)
  @MinLength(1)
  @IsString()
  path!: string;

  /** What happened to it. */
  @IsIn(RUN_FILE_STATUSES)
  status!: RunFileStatus;

  /**
   * Lines added **against the run's base**, not since the last report.
   *
   * V047 is explicit that a second report of a file *replaces* its counts: *"an ingestion path
   * that adds instead of replacing produces counts that climb forever"*. Defaulted to 0, which
   * is what a `deleted` file must have.
   */
  @Max(10_000_000)
  @Min(0)
  @IsInt()
  @IsOptional()
  additions?: number;

  /** Lines removed against the run's base. 0 for an `added` file. */
  @Max(10_000_000)
  @Min(0)
  @IsInt()
  @IsOptional()
  deletions?: number;
}

/** `PUT /internal/runs/:id/files` — report the change-set as it stands. */
export class ReportFilesDto extends IdempotentRequestDto {
  /**
   * The **whole** change-set, not the delta.
   *
   * A `PUT` because that is what it is: the reported set replaces the stored one, so a file
   * an executor reverted disappears from the card rather than lingering at `+0 −0`. Empty is
   * allowed and means *this run has changed nothing* — which is the acceptance criterion's
   * other half: a report with no files triggers no guardrail evaluation, because there is no
   * change-set to judge.
   */
  @ValidateNested({ each: true })
  @Type(() => IngestFileDto)
  @ArrayMaxSize(MAX_FILES_PER_REPORT)
  @IsArray()
  files!: IngestFileDto[];
}

/** One commit a run has made. */
export class IngestCommitDto {
  /** The object name, abbreviated or whole — and the key a re-report collides on. */
  @Matches(SHA_PATTERN, { message: "sha must be 7 to 40 lower-case hex characters" })
  @IsString()
  sha!: string;

  /** The message, whole. `run_commits_message_present` bounds it. */
  @Matches(/[^\s]/, { message: "message must not be blank" })
  @MaxLength(MAX_COMMIT_MESSAGE_LENGTH)
  @MinLength(1)
  @IsString()
  message!: string;

  /**
   * When it was made, by git's clock.
   *
   * Required, and deliberately not defaulted to the report's arrival: V047 keeps
   * `committed_at` and `reported_at` apart precisely so the gap between them is legible as
   * ingestion lag, and a default would close that gap with a fiction.
   */
  @IsISO8601({ strict: true })
  committedAt!: string;
}

/** `POST /internal/runs/:id/commits` — append commits. */
export class ReportCommitsDto extends IdempotentRequestDto {
  /** The commits, oldest first. A sha already reported is a no-op, whatever request it is in. */
  @ValidateNested({ each: true })
  @Type(() => IngestCommitDto)
  @ArrayMaxSize(MAX_COMMITS_PER_REPORT)
  @ArrayMinSize(1)
  @IsArray()
  commits!: IngestCommitDto[];
}

/** What a run spent, as one attributed delta. */
export class TokenSpendDto {
  /** Which provider served it — `token_usage_provider_format`. */
  @Matches(/^[a-z0-9]+([._-][a-z0-9]+)*$/, { message: "provider must be a lower-case slug" })
  @MaxLength(64)
  @IsString()
  provider!: string;

  /** Which model — the id, not an alias: the ledger records what actually answered. */
  @MaxLength(200)
  @MinLength(1)
  @IsString()
  model!: string;

  /** Prompt tokens. */
  @Max(1_000_000_000)
  @Min(0)
  @IsInt()
  tokensIn!: number;

  /** Completion tokens. */
  @Max(1_000_000_000)
  @Min(0)
  @IsInt()
  tokensOut!: number;

  /**
   * What it cost, in cents, to four decimal places — or absent.
   *
   * Absent is *unpriced*, which decisions **M7** and **N10** make a first-class answer: a model
   * with no price in the catalog yields a count and no money, and the console renders the
   * count rather than a zero. A string rather than a number because `numeric(14,4)` does not
   * round-trip through a double, and a tenth of a cent lost per call is a bill that drifts.
   */
  @Matches(/^\d{1,10}(\.\d{1,4})?$/, {
    message: "costCents must be a non-negative decimal with at most four decimal places",
  })
  @IsString()
  @IsOptional()
  costCents?: string;

  /** Which task kind it is attributed to, for the routing ledger (V020). */
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, { message: "taskKind must be a lower-case slug" })
  @MaxLength(64)
  @IsString()
  @IsOptional()
  taskKind?: string;

  /** How long the call took. */
  @Max(86_400_000)
  @Min(0)
  @IsInt()
  @IsOptional()
  latencyMs?: number;

  /** When it happened. The server's `now()` when absent. */
  @IsISO8601({ strict: true })
  @IsOptional()
  occurredAt?: string;
}

/** `POST /internal/runs/:id/resources` — token and cost deltas, and the farm link. */
export class ReportResourcesDto extends IdempotentRequestDto {
  /**
   * The spend to attribute, or absent.
   *
   * Optional because a report may be *only* a reservation: a run holds a build job before it
   * has spent anything on one, and requiring a zero-token row to say so would put a row in
   * the ledger that never happened.
   */
  @IsObject()
  @ValidateNested()
  @Type(() => TokenSpendDto)
  @IsOptional()
  spend?: TokenSpendDto;

  /**
   * The build job this run holds on the farm — `build_jobs.id`, `null` to release, absent to
   * say nothing.
   *
   * What the Resources card renders as *"forge-02 reserved"*. Validated against the run's
   * workspace, which V047's composite foreign key requires anyway; caught in the service so
   * the answer is `build_job_not_found` rather than a constraint name.
   *
   * **Three states rather than two, which is why `null` is meaningful here and nowhere else
   * on this surface.** A report that says nothing about the reservation is the common case —
   * a run posts its token spend far more often than it changes which job it holds — so
   * *absent* has to mean *leave it alone*. That leaves no room for *release* unless `null`
   * says it, and a separate boolean flag would have made *"take this job and also release"* a
   * body the contract publishes and the service then refuses.
   */
  @IsUUID()
  @IsOptional()
  reservedBuildJob?: string | null;
}
