/**
 * Every way the ingestion contract says no, and the reason each one is its own word.
 *
 * AP.1 ([#303](https://github.com/NobuData/ouroboros/issues/303)) has an acceptance criterion
 * that is unusual in being *about the refusals*:
 *
 * > An invalid stage transition is rejected **with a machine-readable reason**, not a generic
 * > 400.
 *
 * The reader of these codes is not a person. It is an executor deciding, without help, which
 * of three things to do: **retry** the request unchanged, **fix** it and send it again, or
 * **stop**. A `400 bad_request` answers none of those, and the cost of guessing is an
 * executor that retries a permanent refusal for the length of a run or abandons a run over a
 * transient one. So every refusal below names the fault precisely enough to choose, and
 * carries the two or three values the caller needs in `details` rather than in prose.
 *
 * ---------------------------------------------------------------------------
 * **The three families, and the answer each one asks for.**
 *
 *   * **`404`** — no such run, no such ticket, no such repository, no such pinned workflow.
 *     *Stop.* Nothing the executor does to the request makes these succeed, and a run it
 *     cannot find is a run somebody deleted.
 *   * **`409`** — the request is well-formed and disagrees with the state: a transition the
 *     state machine forbids, an attempt past the pinned limit, a batch that overtook another
 *     one, a key reused for a different body. *Fix and resend*, except the last, which is
 *     *stop and look*.
 *   * **`422`** — the body is not the shape the contract publishes. The global validation
 *     pipe answers these, not this file; they are listed in `openapi.internal.yaml` beside
 *     each operation.
 *
 * There is deliberately **no `403`** on this surface. Both principals reach every route —
 * `internal.principal.ts` explains why the distinction is a watermark rather than a
 * permission — so the only thing a caller can be refused for is *who they are not*, and that
 * is the `401` the guard already answers.
 *
 * ---------------------------------------------------------------------------
 * **`404` and not `403` for a run in another workspace.** There is no cross-workspace case on
 * this channel to hide from — the caller is inside the network and its workspace is resolved
 * from the run rather than claimed — but a run that does not exist and a run somebody else
 * owns give the same answer anyway, because the ingestion path never learns which it was: the
 * lookup is by id, and a workspace is what it *returns*.
 */

import { ConflictError, InvalidRequestError, NotFoundError } from "../errors/error.envelope";
import type { RunStageStatus } from "../db/schema";
import type { RunIngestOperation } from "../db/schema";

/**
 * The codes, as one object.
 *
 * `as const` so each value is its own literal type, and so `ingest.errors.spec.ts` can hold
 * the internal specification's copy to these — the same arrangement `internal.errors.ts` has,
 * for the same reason: a code that is documented and a code that is thrown must be one
 * string.
 */
export const INGEST_ERRORS = {
  /** No such run — `:id` names nothing. */
  runNotFound: "run_not_found",

  /** The ticket a run is being opened for is not in the canonical mirror. */
  ticketNotFound: "ticket_not_found",

  /** The ticket's key names more than one ticket in its source. */
  ticketAmbiguous: "ticket_ambiguous",

  /** The ticket's source numbers its issues in a way `runs.issue_number` cannot hold. */
  ticketNotNumbered: "ticket_not_numbered",

  /** No such repository, or one belonging to another workspace than the ticket's. */
  repositoryNotFound: "repository_not_found",

  /** The workflow version a run pins is not published in that workspace. */
  workflowPinNotFound: "workflow_pin_not_found",

  /** The pinned version exists and its stored document cannot be read as a workflow. */
  workflowPinUnreadable: "workflow_pin_unreadable",

  /** The pinned document names no stage by that key. */
  stageNotInPin: "stage_not_in_pin",

  /** The state machine forbids this move. */
  stageTransitionInvalid: "stage_transition_invalid",

  /** This attempt is past the number the pinned DSL allows. */
  attemptLimitExceeded: "attempt_limit_exceeded",

  /** A gate return was reported for something that is not a retry. */
  stageReturnNotARetry: "stage_return_not_a_retry",

  /** The batch's hints do not continue this run's accepted order. */
  eventsOutOfOrder: "events_out_of_order",

  /** No such build job to reserve, or one belonging to another workspace. */
  buildJobNotFound: "build_job_not_found",

  /** This key has already answered a different request. */
  idempotencyKeyReused: "idempotency_key_reused",

  /** The deployment does not run live loops, so nothing is claimable (DG.2; #91). */
  deploymentDisabled: "deployment_disabled",

  /** The engine has registered no stage executor, so nothing is claimable (DI.4, #1312). */
  noExecutor: "no_executor",

  /** The workspace already runs as many live runs as its ceiling allows (DI.4, #1312). */
  concurrencyCeiling: "concurrency_ceiling",

  /** The workspace a claim names does not exist (#91). */
  workspaceNotFound: "workspace_not_found",

  /** The queue item a run is opened from is no longer held under that lease (#91). */
  queueClaimLost: "queue_claim_lost",

  /** The queue item a run is opened from is for another issue, repository or pin (#91). */
  queueItemMismatch: "queue_item_mismatch",

  /** Only live runs execute; this one is simulated or seeded (#160). */
  runSimulated: "run_simulated",

  /** The run is not `coding` or `building` any more, so nothing may execute it (#160). */
  runNotExecutable: "run_not_executable",

  /** The write carried an execution epoch another start has superseded (#160). */
  fenced: "fenced",

  /** The run's base commit is already set, to a different commit (#160). */
  baseCommitMismatch: "base_commit_mismatch",
} as const;

/** One of {@link INGEST_ERRORS}' values. */
export type IngestErrorCode = (typeof INGEST_ERRORS)[keyof typeof INGEST_ERRORS];

/**
 * `404` — there is no such run to report against.
 *
 * @param run - The run id that was asked for. Echoed because a driver walking several runs
 *   needs to know which one is gone.
 * @returns The error to throw.
 */
export function runNotFound(run: string): NotFoundError {
  return new NotFoundError(
    INGEST_ERRORS.runNotFound,
    "No such run. A report is made against the run it is about.",
    { run },
  );
}

/**
 * `404` — the canonical mirror holds no such ticket.
 *
 * A run is opened *for a ticket*, and the ticket is what resolves the workspace — so this is
 * also the answer to *"that source is not this deployment's"*. An executor that gets it has
 * either raced the intake sync or been handed a key from somewhere else.
 *
 * @param source - The ticket source that was named.
 * @param externalKey - The key that was looked for.
 * @returns The error to throw.
 */
export function ticketNotFound(source: string, externalKey: string): NotFoundError {
  return new NotFoundError(
    INGEST_ERRORS.ticketNotFound,
    "No such ticket in that source. A run is opened for a ticket the intake has mirrored.",
    { source, externalKey },
  );
}

/**
 * `409` — that key names more than one ticket in its source.
 *
 * `tickets.external_key` is deliberately not unique (V030): *"two sources may hold the same
 * key, and the acceptance criterion requires it"*. Within **one** source a duplicate is
 * possible too — a provider whose display form is not injective — and picking one of them
 * would open the run for whichever row sorted first. Refusing is the only answer that is
 * true, and the fix is to name the ticket by the source that does distinguish them.
 *
 * @param source - The source that was searched.
 * @param externalKey - The key that matched more than once.
 * @returns The error to throw. It says *more than one* and not *how many*: the lookup stops
 *   at the second match, because the answer is the same for two as for twenty and reading the
 *   rest would be a scan on the way to a refusal.
 */
export function ticketAmbiguous(source: string, externalKey: string): ConflictError {
  return new ConflictError(
    INGEST_ERRORS.ticketAmbiguous,
    "That key names more than one ticket in that source, so it does not say which run to " +
      "open.",
    { source, externalKey },
  );
}

/**
 * `409` — that ticket's identifier is not a number, and `runs.issue_number` is.
 *
 * V008 gave a run an `integer` issue number; V030 made a ticket's identity `text`, because
 * Jira's is `PROJ-142` and Linear's is a uuid. A run for such a ticket has nowhere to put its
 * identity, and inventing one — a hash, a row counter — would produce a number the console
 * renders and no tracker recognises.
 *
 * So this is a limitation **named** rather than papered over. It is a `409` and not a `422`
 * because nothing about the request is malformed: the caller asked for something the
 * read-model cannot yet hold, and widening it is a `runs` migration rather than a retry.
 *
 * @param externalId - The identifier that is not a number.
 * @returns The error to throw.
 */
export function ticketNotNumbered(externalId: string): ConflictError {
  return new ConflictError(
    INGEST_ERRORS.ticketNotNumbered,
    "That ticket's identifier is not a number, and a run stores one. Runs can currently be " +
      "opened only for sources that number their tickets.",
    { externalId },
  );
}

/**
 * `404` — no such repository in the ticket's workspace.
 *
 * @param repository - The repository id that was named.
 * @returns The error to throw. It does not say whether the repository exists elsewhere,
 *   because the lookup is scoped to the workspace and never learns.
 */
export function repositoryNotFound(repository: string): NotFoundError {
  return new NotFoundError(
    INGEST_ERRORS.repositoryNotFound,
    "No such repository in this workspace. A run works on a branch of a repository the " +
      "workspace has connected.",
    { repository },
  );
}

/**
 * `404` — that workflow version is not published here.
 *
 * The pin is a *snapshot* (V008 decision F8, V045), which is exactly why it has to exist at
 * the moment it is taken: everything a stage transition later derives — the label, the
 * position, the attempt limit, the token budget — comes from this document, and a run pinned
 * to a version nobody published would have no source for any of them.
 *
 * @param workflowTag - The workflow's slug.
 * @param version - The version that was asked for.
 * @returns The error to throw.
 */
export function workflowPinNotFound(workflowTag: string, version: number): NotFoundError {
  return new NotFoundError(
    INGEST_ERRORS.workflowPinNotFound,
    "No such published workflow version in this workspace. A run pins the version it runs " +
      "under, and the pin is a snapshot of a document that has to exist when it is taken.",
    { workflowTag, version },
  );
}

/**
 * `409` — that version exists and its document cannot be read.
 *
 * Distinct from `workflow_pin_not_found`, and the distinction is what an operator needs: the
 * first says *nobody published that*, and this says *somebody published something this
 * service cannot read*. A published version cannot reach this state through the studio — the
 * publish gate validates the document — so it means the row was written by something else,
 * and the answer that names the version is the one that leads somewhere.
 *
 * Refused at *creation* rather than at the first stage transition, because every stage fact
 * the contract derives comes from this document: a run pinned to an unreadable version would
 * open successfully and then refuse every transition with `stage_not_in_pin`, which is a true
 * answer to the wrong question.
 *
 * @param workflowTag - The workflow's slug.
 * @param version - The version that was asked for.
 * @returns The error to throw.
 */
export function workflowPinUnreadable(workflowTag: string, version: number): ConflictError {
  return new ConflictError(
    INGEST_ERRORS.workflowPinUnreadable,
    "That workflow version's stored document cannot be read as a workflow, so a run cannot " +
      "pin it.",
    { workflowTag, version },
  );
}

/**
 * `409` — the pinned document has no stage by that key.
 *
 * @param stageKey - The DSL node id that was reported.
 * @param workflowTag - The workflow the run is pinned to.
 * @param version - The pinned version.
 * @returns The error to throw. It names the pin as well as the key, because an executor
 *   running against a *republished* workflow is the likely cause and the version is what
 *   makes that visible.
 */
export function stageNotInPin(
  stageKey: string,
  workflowTag: string,
  version: number,
): ConflictError {
  return new ConflictError(
    INGEST_ERRORS.stageNotInPin,
    "The workflow version this run is pinned to has no stage by that key.",
    { stageKey, workflowTag, version },
  );
}

/**
 * `409` — the state machine forbids that move.
 *
 * **The criterion this file exists for.** `details` carries the stage, the attempt, where it
 * stands and where the request tried to take it — which together are the whole of what an
 * executor needs to know whether it lost a response (its own state is behind) or has a bug
 * (its own state is impossible).
 *
 * @param stageKey - The stage.
 * @param attempt - Which attempt of it.
 * @param from - The status the row is in, or `null` when the row does not exist yet.
 * @param to - The status that was asked for.
 * @returns The error to throw.
 */
export function stageTransitionInvalid(
  stageKey: string,
  attempt: number,
  from: RunStageStatus | null,
  to: RunStageStatus,
): ConflictError {
  return new ConflictError(
    INGEST_ERRORS.stageTransitionInvalid,
    from === null
      ? `A stage attempt cannot begin in ${to}.`
      : `A stage attempt cannot move from ${from} to ${to}.`,
    { stageKey, attempt, from, to },
  );
}

/**
 * `409` — this attempt is past what the pinned workflow allows.
 *
 * The `/3` of *attempt 2/3* is `limits.max_retries + 1`, snapshotted at pin time. A run that
 * exceeded it would render a stepper reading `attempt 4/3`, which is a stepper saying
 * something untrue about the document it is running.
 *
 * @param stageKey - The stage.
 * @param attempt - The attempt that was asked for.
 * @param maxAttempts - What the pin allows.
 * @returns The error to throw.
 */
export function attemptLimitExceeded(
  stageKey: string,
  attempt: number,
  maxAttempts: number,
): ConflictError {
  return new ConflictError(
    INGEST_ERRORS.attemptLimitExceeded,
    `That stage allows ${maxAttempts} attempts under the pinned workflow, and this is ` +
      `attempt ${attempt}.`,
    { stageKey, attempt, maxAttempts },
  );
}

/**
 * `409` — a gate return was reported for an attempt that is not a retry.
 *
 * V045's `run_stages_return_is_a_retry` says the same thing in the schema: the note opens
 * *"attempt N−1 …"* and there is no attempt 0 for a gate to have failed. Caught here so the
 * caller gets a code rather than a constraint name.
 *
 * @param stageKey - The stage.
 * @param attempt - The attempt the return was reported on.
 * @returns The error to throw.
 */
export function stageReturnNotARetry(stageKey: string, attempt: number): ConflictError {
  return new ConflictError(
    INGEST_ERRORS.stageReturnNotARetry,
    "A loop return describes the attempt before this one, so it cannot be reported on a " +
      "first attempt.",
    { stageKey, attempt },
  );
}

/**
 * `409` — this batch does not continue the run's accepted order.
 *
 * The other half of *"rejects out-of-order batches with a reason rather than silently
 * reordering"*. `details` carries the hint the run stands at and the hint that arrived, so
 * the executor can tell *I am re-sending something already accepted* from *I have a batch
 * from the future*, which are different bugs with different fixes.
 *
 * @param accepted - The highest hint this run has accepted — `runs.event_hint`.
 * @param offered - The first hint of the batch that was refused.
 * @returns The error to throw.
 */
export function eventsOutOfOrder(accepted: number, offered: number): ConflictError {
  return new ConflictError(
    INGEST_ERRORS.eventsOutOfOrder,
    `This run's transcript has accepted ordering hint ${accepted}, and this batch opens at ` +
      `${offered}. Batches are not reordered: re-send from the next hint.`,
    { accepted, offered },
  );
}

/**
 * `404` — no such build job to reserve.
 *
 * @param buildJob - The job id that was named.
 * @returns The error to throw. Scoped to the run's workspace, so a job of another one is
 *   absent rather than forbidden — V047's foreign key says the same thing.
 */
export function buildJobNotFound(buildJob: string): NotFoundError {
  return new NotFoundError(
    INGEST_ERRORS.buildJobNotFound,
    "No such build job in this workspace. A run reserves a job of its own workspace.",
    { buildJob },
  );
}

/**
 * `409` — that key has already answered a different request.
 *
 * The refusal a stored response makes necessary, and the one that is *stop and look* rather
 * than *fix and resend*. Answering the second request with the first one's result would be
 * the worst available outcome: the caller would be told its report landed, and it would not
 * have.
 *
 * `details` carries the operation and the key and **never the stored response**, which
 * belongs to whatever request first used the key and may describe rows this caller has not
 * been shown.
 *
 * @param operation - Which operation the key was first used for.
 * @param idempotencyKey - The key.
 * @returns The error to throw.
 */
export function idempotencyKeyReused(
  operation: RunIngestOperation,
  idempotencyKey: string,
): ConflictError {
  return new ConflictError(
    INGEST_ERRORS.idempotencyKeyReused,
    "That idempotency key has already answered a different request. A key names one " +
      "submission; use a fresh one, or re-send the submission it named.",
    { operation, idempotencyKey },
  );
}

/**
 * `409` — this deployment does not run live loops, so a claim takes nothing (#91; DG.2,
 * [#1300](https://github.com/NobuData/ouroboros/issues/1300)).
 *
 * The first of the admission refusals the claim makes before a queued item becomes paid work;
 * DI.4 ([#1312](https://github.com/NobuData/ouroboros/issues/1312)) adds the rest in the same
 * place (`admission/admission.ts`). Refused rather than answered `204`: an empty queue and a
 * switched-off deployment are different things to an operator reading the worker's log.
 *
 * @returns The error to throw.
 */
export function deploymentDisabled(): ConflictError {
  return new ConflictError(
    INGEST_ERRORS.deploymentDisabled,
    "This deployment does not run live loops: OURO_LIVE_EXECUTION_ENABLED is off. Nothing was claimed.",
  );
}

/**
 * `409` — the engine has registered no stage executor, so nothing it claimed could run (DI.4,
 * [#1312](https://github.com/NobuData/ouroboros/issues/1312)).
 *
 * @returns The error to throw.
 */
export function noExecutor(): ConflictError {
  return new ConflictError(
    INGEST_ERRORS.noExecutor,
    "The engine has registered no stage executor, so no queued item can run. Nothing was claimed.",
  );
}

/**
 * `409` — the workspace already runs as many live runs as its ceiling allows (DI.4,
 * [#1312](https://github.com/NobuData/ouroboros/issues/1312)). Held under a per-workspace lock,
 * so two workers racing for the last slot get one item and one of these.
 *
 * @param taken - Live runs executing plus items leased and not yet opened.
 * @param ceiling - The ceiling the claim enforces.
 * @returns The error to throw.
 */
export function concurrencyCeiling(taken: number, ceiling: number): ConflictError {
  return new ConflictError(
    INGEST_ERRORS.concurrencyCeiling,
    `This workspace already runs ${taken} of its ${ceiling} live-run slots. Nothing was claimed.`,
    { taken, ceiling },
  );
}

/**
 * `404` — the workspace a claim names does not exist (#91).
 *
 * @param workspace - The id or slug that was named.
 * @returns The error to throw.
 */
export function claimWorkspaceNotFound(workspace: string): NotFoundError {
  return new NotFoundError(
    INGEST_ERRORS.workspaceNotFound,
    "There is no workspace by that id or slug.",
    { workspace },
  );
}

/**
 * `409` — the queue item a run is opened from is not held under that lease any more (#91):
 * the lease ran out and another worker claimed the item, the token is not the lease's, or the
 * item is gone. Nothing was opened; the worker claims again.
 *
 * @param queueItem - The item that was named.
 * @returns The error to throw.
 */
export function queueClaimLost(queueItem: string): ConflictError {
  return new ConflictError(
    INGEST_ERRORS.queueClaimLost,
    "That queue item is no longer held under this lease. Nothing was opened; claim again.",
    { queueItem },
  );
}

/**
 * `422` — the queue item a run is opened from is not the run being opened (#91): another
 * workspace, repository, issue or workflow pin. Nothing was opened and the lease is kept.
 *
 * @param queueItem - The item that was named.
 * @param field - The first field that differs.
 * @returns The error to throw.
 */
export function queueItemMismatch(queueItem: string, field: string): InvalidRequestError {
  return new InvalidRequestError(
    INGEST_ERRORS.queueItemMismatch,
    `That queue item is not for the run being opened: its ${field} differs.`,
    { queueItem, field },
  );
}

/**
 * `409` — only live runs execute (#160, ADR decision A). A simulated run is reported by the
 * simulator and a seeded one by its seed; neither is ever interpreted, so neither may be started.
 *
 * @param run - The run that was asked for.
 * @param origin - What it is instead — `simulated` or `seeded`.
 * @returns The error to throw.
 */
export function runSimulated(run: string, origin: string): ConflictError {
  return new ConflictError(
    INGEST_ERRORS.runSimulated,
    "Only live runs execute; this run is simulated or seeded. Nothing was started.",
    { run, origin },
  );
}

/**
 * `409` — the run is not `coding` or `building` (#160): it has finished, a person cancelled it,
 * or it has moved on to review. Nothing may execute it any more; an engine told this stops.
 *
 * @param run - The run.
 * @param status - Where it stands.
 * @returns The error to throw.
 */
export function runNotExecutable(run: string, status: string): ConflictError {
  return new ConflictError(
    INGEST_ERRORS.runNotExecutable,
    "This run is no longer coding or building, so nothing may execute it. Stop.",
    { run, status },
  );
}

/**
 * `409` — the write carried an epoch another start has superseded (#160, ADR decision A): a
 * newer worker holds the run. The write was refused whole; the stale worker stops without
 * finishing.
 *
 * @param currentEpoch - The epoch the run is at — `details.current_epoch`, spelled as the
 *   execution contract spells its fields.
 * @returns The error to throw.
 */
export function fenced(currentEpoch: number): ConflictError {
  return new ConflictError(
    INGEST_ERRORS.fenced,
    "Another worker has started this run since; this write carried a superseded epoch. Stop.",
    { current_epoch: currentEpoch },
  );
}

/**
 * `409` — the run's base commit is already set, to another commit (#160). A base commit is set
 * once (V147's `runs_exec_base_commit_immutable`), so a resumed run reopens on the same base and
 * never rebases silently.
 *
 * @param current - The base commit the run holds.
 * @param offered - The one this checkpoint named.
 * @returns The error to throw.
 */
export function baseCommitMismatch(current: string, offered: string): ConflictError {
  return new ConflictError(
    INGEST_ERRORS.baseCommitMismatch,
    "This run's base commit is already set to another commit. Nothing was saved.",
    { current, offered },
  );
}
