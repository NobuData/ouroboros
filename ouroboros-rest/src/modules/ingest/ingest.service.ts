/**
 * The ingestion contract, as six operations over one transaction each.
 *
 * AP.1 ([#303](https://github.com/NobuData/ouroboros/issues/303)), decision **R2** — the
 * load-bearing decision of the Run Console roadmap, and it is a decision about *sequencing*:
 * the console ships before real execution, so the contract is built first and driven by a
 * simulator, and the only thing v2 changes is who is calling.
 *
 * ```
 * POST   /internal/runs                        open a run, pin a workflow version
 * POST   /internal/runs/:id/stage-transitions  move one stage attempt
 * POST   /internal/runs/:id/events             append to the transcript
 * PUT    /internal/runs/:id/files              report the change-set, trigger guardrails
 * POST   /internal/runs/:id/commits            append commits
 * POST   /internal/runs/:id/resources          attribute spend, hold or release a build job
 * ```
 *
 * ---------------------------------------------------------------------------
 * **The five statements every operation makes, in this order, and the order is the design.**
 *
 *   1. **Resolve the workspace from a row the caller named** — the ticket for a create, the
 *      run for everything else. Never from the body: AD.3's rule for this channel.
 *   2. **Lock**, for every run-scoped write. Four counters are allocated per run and three of
 *      the ticket's acceptance criteria are about interleaving; `ingest.repository.ts`'s
 *      header is where that argument is.
 *   3. **Replay**, before any work. A key already answered returns its stored response and
 *      touches nothing; a key presented with a different body is refused. This is *before*
 *      validation on purpose — a replay must be a no-op even if the state has moved on since,
 *      because the caller is asking what it was told, not asking to be told again.
 *   4. **Do the work**, refusing with a code rather than with a constraint name wherever the
 *      database would have refused anyway.
 *   5. **Record the receipt**, in the same transaction — so a receipt cannot exist for work
 *      that rolled back, and work cannot commit without the receipt that makes it replayable.
 *
 * **Step 5 has a race, and it is handled rather than hoped about.** Two concurrent first
 * deliveries of the same key both find no receipt and both insert one; PostgreSQL refuses the
 * second. That is a `23505` on `run_ingest_receipts_scope_key`, and
 * {@link IngestService.commitReceipt} turns it into the replay it actually is — the loser
 * re-reads the winner's receipt and answers with it. Without that, a retry sent twice in
 * flight would produce a `500`, which is the one answer an executor cannot act on.
 *
 * ---------------------------------------------------------------------------
 * **What this service deliberately does not do: move `runs.status`.**
 *
 * V008's `status` is the dashboard's word for a run — `coding`, `building`, `review`,
 * `merged`, `needs_human`, `failed` — and none of the six operations the issue specifies
 * carries it. A run opens in `coding` and stays there until something closes it, and *what
 * closes it* is a question with an answer that is not in this ticket: a terminal node's action
 * decides it (WF-T.6), and a control can abort it (AP.4, #306). Inferring it here — *"the last
 * stage succeeded, so the run is merged"* — would be this service guessing at a workflow's
 * semantics from its stage rows, and it would be wrong for every document whose last node is
 * `needs_review`.
 */

import { Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";

import type { Database, Run, RunIngestOperation, RunStage } from "../db/schema";
import { isDatabaseFailure } from "../tenancy/constraints";
import {
  GUARDRAIL_SCHEDULER,
  InjectGuardrailScheduler,
  type GuardrailScheduler,
} from "./ingest.guardrails";
import type {
  IngestEventsDto,
  OpenRunDto,
  ReportCommitsDto,
  ReportFilesDto,
  ReportResourcesDto,
  StageTransitionDto,
} from "./ingest.dto";
import {
  attemptLimitExceeded,
  buildJobNotFound,
  eventsOutOfOrder,
  idempotencyKeyReused,
  repositoryNotFound,
  runNotFound,
  stageNotInPin,
  stageReturnNotARetry,
  stageTransitionInvalid,
  ticketAmbiguous,
  ticketNotFound,
  ticketNotNumbered,
  workflowPinNotFound,
  workflowPinUnreadable,
} from "./ingest.errors";
import { requestDigest } from "./ingest.idempotency";
import { readPinnedWorkflow, type PinnedStage, type PinnedWorkflow } from "./ingest.pin";
import { IngestRepository, type Writer } from "./ingest.repository";
import type {
  ChangeSetResource,
  CommitsAppendedResource,
  EventsAppendedResource,
  ResourcesReportedResource,
  RunOpenedResource,
  StageTransitionResource,
} from "./ingest.resources";
import { canTransition, hasFinished, hasStarted } from "./ingest.transitions";

/**
 * The constraint a concurrent first delivery collides on.
 *
 * Named rather than matched on SQLSTATE, so a rename in V049 stops matching here rather than
 * silently changing an answer — `workflows.errors.ts` makes the same argument.
 */
export const RECEIPT_KEY_CONSTRAINT = "run_ingest_receipts_scope_key";

/** What a replay lookup found. */
type Replay<T> =
  /** This key has never been used: do the work. */
  | { readonly replayed: false }
  /** This key answered this request: hand back what it was told. */
  | { readonly replayed: true; readonly response: T };

@Injectable()
export class IngestService {
  /**
   * @param runs - Every statement the contract issues.
   * @param guardrails - What a change-set report triggers. Injected by token, because AP.3
   *   ([#305](https://github.com/NobuData/ouroboros/issues/305)) substitutes for it.
   */
  constructor(
    private readonly runs: IngestRepository,
    @InjectGuardrailScheduler() private readonly guardrails: GuardrailScheduler,
  ) {}

  // --- POST /internal/runs ----------------------------------------------------------------

  /**
   * Open a run.
   *
   * @param request - The ticket, the repository, the pin, the model and the branch.
   * @param simulated - Whether this run carries decision R4's watermark. Derived by the
   *   controller from the principal the guard proved, and taken as a parameter rather than
   *   read from the request for the reason the whole mechanism exists: a value that arrived
   *   in the body would be a claim.
   * @returns The run, including the `loop_seq` the database allocated.
   * @throws {NotFoundError} `404 ticket_not_found`, `404 repository_not_found`, `404
   *   workflow_pin_not_found`.
   * @throws {ConflictError} `409 ticket_ambiguous`, `409 ticket_not_numbered`, `409
   *   workflow_pin_unreadable`, `409 idempotency_key_reused`.
   */
  async openRun(request: OpenRunDto, simulated: boolean): Promise<RunOpenedResource> {
    const digest = requestDigest(request);

    return this.runs.transaction(async (trx) => {
      const tickets = await this.runs.ticketsByKey(
        trx,
        request.ticket.source,
        request.ticket.externalKey,
      );

      if (tickets.length === 0) {
        throw ticketNotFound(request.ticket.source, request.ticket.externalKey);
      }

      if (tickets.length > 1) {
        throw ticketAmbiguous(request.ticket.source, request.ticket.externalKey);
      }

      const ticket = tickets[0];
      const replay = await this.replayed<RunOpenedResource>(
        trx,
        ticket.organizationId,
        "run.create",
        request.idempotencyKey,
        digest,
      );

      if (replay.replayed) {
        return replay.response;
      }

      // `issue_number` is an integer and `external_id` is text, which is V008 and V030
      // disagreeing about what a ticket is. The disagreement is named rather than papered
      // over: see `ticketNotNumbered`.
      const issueNumber = Number(ticket.externalId);

      if (!Number.isInteger(issueNumber) || issueNumber < 1) {
        throw ticketNotNumbered(ticket.externalId);
      }

      if (!(await this.runs.repositoryBelongsTo(trx, ticket.organizationId, request.repository))) {
        throw repositoryNotFound(request.repository);
      }

      const pin = await this.resolvePin(
        trx,
        ticket.organizationId,
        request.workflow.tag,
        request.workflow.version,
      );

      if (pin.firstStage === undefined) {
        throw workflowPinUnreadable(request.workflow.tag, request.workflow.version);
      }

      const run = await this.runs.insertRun(trx, {
        organization_id: ticket.organizationId,
        github_repo_id: request.repository,
        issue_number: issueNumber,
        issue_title: ticket.title,
        workflow_tag: request.workflow.tag,
        workflow_version_pin: request.workflow.version,
        model: request.model,
        // V008's three current-stage columns are `not null` and are what mockup 02 renders
        // until the run has stage history — after which `runs_with_stage` resolves the meter
        // from `run_stage_current` and these stop being read. The honest values at the moment
        // a run opens are: the first stage of the pinned document, none of them entered, and
        // as many as the document draws.
        stage_label: pin.firstStage.label,
        stage_index: 0,
        stage_total: pin.stageTotal,
        branch_name: request.branchName ?? null,
        merge_strategy: request.mergeStrategy ?? null,
        simulated,
      });

      const response: RunOpenedResource = {
        id: run.id,
        loopSeq: run.loop_seq,
        organizationId: run.organization_id,
        issueNumber: run.issue_number,
        issueTitle: run.issue_title,
        workflowTag: run.workflow_tag,
        workflowVersionPin: request.workflow.version,
        branchName: run.branch_name,
        mergeStrategy: run.merge_strategy,
        model: run.model,
        simulated: run.simulated,
        status: run.status,
        startedAt: run.started_at.toISOString(),
      };

      return this.commitReceipt(
        trx,
        ticket.organizationId,
        run.id,
        "run.create",
        request.idempotencyKey,
        digest,
        response,
      );
    });
  }

  // --- POST /internal/runs/:id/stage-transitions -------------------------------------------

  /**
   * Move one stage attempt.
   *
   * @param run - The run.
   * @param request - The stage, the status, optionally the attempt, the instant and the loop
   *   edge it came back through.
   * @returns Where the stage stands afterwards, including the note the **database** composed.
   * @throws {NotFoundError} `404 run_not_found`, `404 workflow_pin_not_found`.
   * @throws {ConflictError} `409 stage_not_in_pin`, `409 stage_transition_invalid`, `409
   *   attempt_limit_exceeded`, `409 stage_return_not_a_retry`, `409 idempotency_key_reused`.
   */
  async transitionStage(
    run: string,
    request: StageTransitionDto,
  ): Promise<StageTransitionResource> {
    const digest = requestDigest(request);

    return this.runs.transaction(async (trx) => {
      const row = await this.locked(trx, run);
      const replay = await this.replayed<StageTransitionResource>(
        trx,
        row.organization_id,
        "run.stage_transition",
        request.idempotencyKey,
        digest,
      );

      if (replay.replayed) {
        return replay.response;
      }

      const stage = await this.pinnedStage(trx, row, request.stageKey);
      const current = await this.runs.stageState(trx, run, request.stageKey);
      const attempt = request.attempt ?? current.attempt ?? 1;

      if (request.returnedFrom !== undefined && attempt < 2) {
        throw stageReturnNotARetry(request.stageKey, attempt);
      }

      if (stage.maxAttempts !== undefined && attempt > stage.maxAttempts) {
        throw attemptLimitExceeded(request.stageKey, attempt, stage.maxAttempts);
      }

      const existing = await this.runs.stageAttempt(trx, run, request.stageKey, attempt);
      const from = existing?.status ?? null;

      if (!canTransition(from, request.status)) {
        throw stageTransitionInvalid(request.stageKey, attempt, from, request.status);
      }

      const at = request.at === undefined ? new Date() : new Date(request.at);
      const written =
        existing === undefined
          ? await this.runs.insertStage(trx, {
              run_id: run,
              stage_key: stage.stageKey,
              stage_label: stage.label,
              position: stage.position,
              attempt,
              status: request.status,
              started_at: hasStarted(request.status) ? at : null,
              finished_at: hasFinished(request.status) ? at : null,
              max_attempts: stage.maxAttempts ?? null,
              token_budget: stage.tokenBudget ?? null,
              returned_from_stage_key: request.returnedFrom?.stageKey ?? null,
              returned_from_kind: request.returnedFrom?.kind ?? null,
              return_reason: request.returnedFrom?.reason ?? null,
            })
          : await this.runs.updateStage(trx, run, request.stageKey, attempt, {
              status: request.status,
              // A clock is set once. `started_at` moves only when the attempt did not have
              // one, so `pending → active → succeeded` records when it began rather than when
              // it ended, and `run_stages_finished_after_started` stays satisfiable.
              ...(hasStarted(request.status) && existing.started_at === null
                ? { started_at: at }
                : {}),
              ...(hasFinished(request.status) ? { finished_at: at } : {}),
            });

      return this.commitReceipt(
        trx,
        row.organization_id,
        run,
        "run.stage_transition",
        request.idempotencyKey,
        digest,
        stageResource(written),
      );
    });
  }

  // --- POST /internal/runs/:id/events -------------------------------------------------------

  /**
   * Append a batch to the transcript.
   *
   * **The ordering check is the whole of this method's argument.** The batch's hints must be
   * strictly increasing, and its first hint must exceed what the run has already accepted.
   * Both halves matter: the first catches an executor whose own numbering is broken, the
   * second catches two batches that overtook one another in flight. Neither is reordered —
   * see `eventsOutOfOrder` and V049's header for why sorting would be worse than refusing.
   *
   * @param run - The run.
   * @param request - The batch, in the executor's own order.
   * @returns How many entries were stored, the dense sequence numbers they got, and whether a
   *   cap has elided this transcript.
   * @throws {NotFoundError} `404 run_not_found`.
   * @throws {ConflictError} `409 events_out_of_order`, `409 idempotency_key_reused`.
   */
  async appendEvents(run: string, request: IngestEventsDto): Promise<EventsAppendedResource> {
    const digest = requestDigest(request);

    return this.runs.transaction(async (trx) => {
      const row = await this.locked(trx, run);
      const replay = await this.replayed<EventsAppendedResource>(
        trx,
        row.organization_id,
        "run.events",
        request.idempotencyKey,
        digest,
      );

      if (replay.replayed) {
        return replay.response;
      }

      let previous = row.event_hint;

      for (const event of request.events) {
        if (event.hint <= previous) {
          throw eventsOutOfOrder(previous, event.hint);
        }

        previous = event.hint;
      }

      const stored = await this.runs.appendEvents(
        trx,
        run,
        request.events.map((event) => ({
          actor: event.actor,
          ...(event.ts === undefined ? {} : { ts: new Date(event.ts) }),
          stage_key: event.stageKey ?? null,
          attempt: event.attempt ?? null,
          tool_tag: event.toolTag ?? null,
          model_id: event.modelId ?? null,
          body: event.body ?? null,
          payload: event.payload ?? null,
        })),
      );

      await this.runs.raiseEventHint(trx, run, previous);

      // The cap's elision marker is the database's row, not one of the caller's entries, so it
      // is excluded from the count and from the range. A caller told `stored: 3` for a batch of
      // five and a `firstSeq` that skips nothing is a caller that can tell what happened.
      const entries = stored.filter((entry) => !entry.marker);
      const counters = await this.runs.eventCounters(trx, run);

      return this.commitReceipt(
        trx,
        row.organization_id,
        run,
        "run.events",
        request.idempotencyKey,
        digest,
        {
          submitted: request.events.length,
          stored: entries.length,
          firstSeq: entries.at(0)?.seq ?? null,
          lastSeq: entries.at(-1)?.seq ?? null,
          hint: counters.hint,
          elided: counters.elided,
        },
      );
    });
  }

  // --- PUT /internal/runs/:id/files ---------------------------------------------------------

  /**
   * Report the change-set as it stands, and judge it.
   *
   * @param run - The run.
   * @param request - The whole change-set, not the delta.
   * @returns The report's number, the totals, how many guardrail checks it evaluated, which of
   *   them failed, and whether that flags the run for a person (`needsHuman`).
   * @throws {NotFoundError} `404 run_not_found`.
   * @throws {ConflictError} `409 idempotency_key_reused`.
   */
  async reportFiles(run: string, request: ReportFilesDto): Promise<ChangeSetResource> {
    const digest = requestDigest(request);

    return this.runs.transaction(async (trx) => {
      const row = await this.locked(trx, run);
      const replay = await this.replayed<ChangeSetResource>(
        trx,
        row.organization_id,
        "run.files",
        request.idempotencyKey,
        digest,
      );

      if (replay.replayed) {
        return replay.response;
      }

      await this.runs.replaceFiles(
        trx,
        run,
        request.files.map((file) => ({
          path: file.path,
          status: file.status,
          additions: file.additions ?? 0,
          deletions: file.deletions ?? 0,
        })),
      );

      const totals = await this.runs.changeSetTotals(trx, run);

      // *"A file report triggers guardrail evaluation; a run with no file changes triggers
      // none."* A report naming no files is not a change-set, so there is nothing to number
      // and nothing to judge — `change_set_seq` stays where it was, which is `0` on a run that
      // has never reported one.
      const changeSetSeq =
        request.files.length === 0
          ? row.change_set_seq
          : await this.runs.allocateChangeSetSeq(trx, run);
      const judged =
        request.files.length === 0
          ? { checks: 0, failures: [] }
          : await this.guardrails.evaluate(trx, {
              runId: run,
              changeSetSeq,
              files: totals.files,
              // The hunks travel to the evaluator and no further: `replaceFiles` above wrote
              // paths and counts only.
              changeSet: request.files.map((file) => ({
                path: file.path,
                ...(file.hunks === undefined ? {} : { hunks: file.hunks }),
              })),
            });

      return this.commitReceipt(
        trx,
        row.organization_id,
        run,
        "run.files",
        request.idempotencyKey,
        digest,
        {
          changeSetSeq,
          ...totals,
          guardrailChecks: judged.checks,
          guardrailFailures: [...judged.failures],
          needsHuman: judged.failures.length > 0,
        },
      );
    });
  }

  // --- POST /internal/runs/:id/commits ------------------------------------------------------

  /**
   * Append commits.
   *
   * Sha-idempotent, as the issue asks, **and** key-idempotent — two different guarantees. The
   * sha key makes a re-reported commit a no-op whatever request it arrives in; the receipt
   * makes a re-sent request a no-op whatever commits it names. An executor that reports an
   * overlapping range under a fresh key gets the second guarantee, and the answer tells it how
   * much of its range was already known.
   *
   * @param run - The run.
   * @param request - The commits, oldest first.
   * @returns How many were new, how many were already recorded, and where the sequence stands.
   * @throws {NotFoundError} `404 run_not_found`.
   * @throws {ConflictError} `409 idempotency_key_reused`.
   */
  async reportCommits(run: string, request: ReportCommitsDto): Promise<CommitsAppendedResource> {
    const digest = requestDigest(request);

    return this.runs.transaction(async (trx) => {
      const row = await this.locked(trx, run);
      const replay = await this.replayed<CommitsAppendedResource>(
        trx,
        row.organization_id,
        "run.commits",
        request.idempotencyKey,
        digest,
      );

      if (replay.replayed) {
        return replay.response;
      }

      const known = await this.runs.knownCommitShas(
        trx,
        run,
        request.commits.map((commit) => commit.sha),
      );
      let seq = await this.runs.lastCommitSeq(trx, run);
      const fresh: { sha: string; message: string; committed_at: Date; seq: number }[] = [];
      // A batch may repeat a sha within itself, and `run_commits_run_seq_key` would refuse the
      // second copy's number rather than the copy. Numbering from a set is what keeps the
      // sequence dense: a number handed to a row that is never written is a gap in the card's
      // ordering.
      const seen = new Set(known);

      for (const commit of request.commits) {
        if (seen.has(commit.sha)) {
          continue;
        }

        seen.add(commit.sha);
        seq += 1;
        fresh.push({
          sha: commit.sha,
          message: commit.message,
          committed_at: new Date(commit.committedAt),
          seq,
        });
      }

      const appended = await this.runs.appendCommits(trx, run, fresh);

      return this.commitReceipt(
        trx,
        row.organization_id,
        run,
        "run.commits",
        request.idempotencyKey,
        digest,
        {
          submitted: request.commits.length,
          appended,
          duplicates: request.commits.length - appended,
          lastSeq: seq === 0 ? null : seq,
        },
      );
    });
  }

  // --- POST /internal/runs/:id/resources ----------------------------------------------------

  /**
   * Attribute spend, and take or release a build-farm reservation.
   *
   * Both halves are optional and a report may be either or both: a run holds a job before it
   * has spent anything on one, and it spends on models that have nothing to do with the farm.
   * What it may not be is *empty* — the DTO allows that shape and the answer to it is the run's
   * current totals, which is a read rather than a report and costs nothing to give.
   *
   * @param run - The run.
   * @param request - The spend, the reservation, or both.
   * @returns What the run has spent in total, and what it now holds.
   * @throws {NotFoundError} `404 run_not_found`, `404 build_job_not_found`.
   * @throws {ConflictError} `409 idempotency_key_reused`.
   */
  async reportResources(
    run: string,
    request: ReportResourcesDto,
  ): Promise<ResourcesReportedResource> {
    const digest = requestDigest(request);

    return this.runs.transaction(async (trx) => {
      const row = await this.locked(trx, run);
      const replay = await this.replayed<ResourcesReportedResource>(
        trx,
        row.organization_id,
        "run.resources",
        request.idempotencyKey,
        digest,
      );

      if (replay.replayed) {
        return replay.response;
      }

      if (request.spend !== undefined) {
        await this.runs.insertTokenUsage(trx, {
          organization_id: row.organization_id,
          run_id: run,
          provider: request.spend.provider,
          model: request.spend.model,
          tokens_in: request.spend.tokensIn,
          tokens_out: request.spend.tokensOut,
          cost_cents: request.spend.costCents ?? null,
          task_kind: request.spend.taskKind ?? null,
          latency_ms: request.spend.latencyMs ?? null,
          ...(request.spend.occurredAt === undefined
            ? {}
            : { occurred_at: new Date(request.spend.occurredAt) }),
        });
      }

      let reserved = row.reserved_build_job_id;

      // `null` releases, a uuid takes, and *absent* says nothing — which is why this branches
      // on the key rather than on the value. See the field's own note in `ingest.dto.ts`.
      if ("reservedBuildJob" in request) {
        const buildJob = request.reservedBuildJob ?? null;

        if (
          buildJob !== null &&
          !(await this.runs.buildJobBelongsTo(trx, row.organization_id, buildJob))
        ) {
          throw buildJobNotFound(buildJob);
        }

        await this.runs.setReservation(trx, run, buildJob);
        reserved = buildJob;
      }

      const spent = await this.runs.spendTotals(trx, run);

      return this.commitReceipt(
        trx,
        row.organization_id,
        run,
        "run.resources",
        request.idempotencyKey,
        digest,
        { ...spent, reservedBuildJobId: reserved },
      );
    });
  }

  // --- the shared five steps ----------------------------------------------------------------

  /**
   * The run, locked for the rest of the transaction.
   *
   * @param trx - The transaction.
   * @param run - The run's id.
   * @returns The row.
   * @throws {NotFoundError} `404 run_not_found` — which covers *no such run* and *somebody
   *   else's run* in one answer, deliberately: the lookup is by id and never learns which.
   */
  private async locked(trx: Transaction<Database>, run: string): Promise<Run> {
    const row = await this.runs.lockRun(trx, run);

    if (row === undefined) {
      throw runNotFound(run);
    }

    return row;
  }

  /**
   * Has this key already been answered?
   *
   * @param writer - The transaction.
   * @param organizationId - The workspace the key is unique within.
   * @param operation - Which operation.
   * @param idempotencyKey - The caller's key.
   * @param digest - The digest of *this* request.
   * @returns The stored response when the key answered this same request, and *not replayed*
   *   when the key is new.
   * @throws {ConflictError} `409 idempotency_key_reused` when the key answered a different
   *   one. The stored response is never included: it belongs to whatever request first used
   *   the key.
   */
  private async replayed<T>(
    writer: Writer,
    organizationId: string,
    operation: RunIngestOperation,
    idempotencyKey: string,
    digest: string,
  ): Promise<Replay<T>> {
    const receipt = await this.runs.findReceipt(writer, organizationId, operation, idempotencyKey);

    if (receipt === undefined) {
      return { replayed: false };
    }

    if (receipt.request_digest !== digest) {
      throw idempotencyKeyReused(operation, idempotencyKey);
    }

    return { replayed: true, response: receipt.response as T };
  }

  /**
   * Record the answer, and hand it back.
   *
   * The last statement of every operation, so the receipt and the rows it describes commit
   * together or not at all.
   *
   * **The `catch` is the concurrent-first-delivery case.** Two deliveries of one key can both
   * pass {@link replayed} and race to insert; PostgreSQL refuses the second on
   * {@link RECEIPT_KEY_CONSTRAINT}. That loser is a replay that arrived a moment too early, so
   * it is answered as one: re-read, compare digests, hand back the winner's response. The
   * rows this transaction wrote roll back with it, which is correct — the winner wrote the
   * same ones.
   *
   * @param trx - The transaction.
   * @param organizationId - The workspace.
   * @param run - The run this submission was about.
   * @param operation - Which operation.
   * @param idempotencyKey - The caller's key.
   * @param digest - The digest of the request.
   * @param response - The answer.
   * @returns The answer — this one, or the winner's when a concurrent delivery got there
   *   first.
   * @throws {ConflictError} `409 idempotency_key_reused`, when the concurrent delivery that
   *   won the race was a different request under the same key.
   */
  private async commitReceipt<T>(
    trx: Transaction<Database>,
    organizationId: string,
    run: string,
    operation: RunIngestOperation,
    idempotencyKey: string,
    digest: string,
    response: T,
  ): Promise<T> {
    try {
      await this.runs.insertReceipt(trx, {
        organization_id: organizationId,
        run_id: run,
        operation,
        idempotency_key: idempotencyKey,
        request_digest: digest,
        response,
      });

      return response;
    } catch (error) {
      if (!isDatabaseFailure(error) || error.constraint !== RECEIPT_KEY_CONSTRAINT) {
        throw error;
      }

      // The losing transaction is poisoned once PostgreSQL has refused a statement inside it,
      // so the winner's receipt is read on a fresh connection rather than on `trx`. This one
      // then rolls back, taking its duplicate rows with it.
      const replay = await this.replayed<T>(
        this.runs.db,
        organizationId,
        operation,
        idempotencyKey,
        digest,
      );

      if (!replay.replayed) {
        // The key collided and is now absent, which means the winner rolled back after
        // colliding with *us*. Nothing to replay and nothing to be done here: rethrow, and the
        // caller's retry finds a clean slate.
        throw error;
      }

      return replay.response;
    }
  }

  /**
   * The pinned workflow document, read.
   *
   * @param writer - The transaction.
   * @param organizationId - The workspace.
   * @param tag - The workflow's slug.
   * @param version - The pinned version.
   * @returns The stages, keyed by node id.
   * @throws {NotFoundError} `404 workflow_pin_not_found`.
   */
  private async resolvePin(
    writer: Writer,
    organizationId: string,
    tag: string,
    version: number,
  ): Promise<PinnedWorkflow> {
    const pinned = await this.runs.pinnedDefinition(writer, organizationId, tag, version);

    if (pinned === undefined) {
      throw workflowPinNotFound(tag, version);
    }

    return readPinnedWorkflow(pinned.definition);
  }

  /**
   * One stage of the run's pinned workflow.
   *
   * @param writer - The transaction.
   * @param run - The run, whose `workflow_tag` and `workflow_version_pin` name the document.
   * @param stageKey - The DSL node id the executor reported.
   * @returns The stage's label, position, kind and limits, as the pin has them.
   * @throws {NotFoundError} `404 workflow_pin_not_found` — a run whose pinned version has been
   *   deleted since. The run still renders, because everything already written is a snapshot;
   *   what it cannot do is take a *new* snapshot.
   * @throws {ConflictError} `409 stage_not_in_pin`.
   */
  private async pinnedStage(writer: Writer, run: Run, stageKey: string): Promise<PinnedStage> {
    // V008's `workflow_version_pin` is nullable because rows predating pinning exist; a run
    // this contract opened always has one, and a run that somehow does not is one whose pin
    // cannot be resolved — which is the same answer as a pin that was deleted.
    if (run.workflow_version_pin === null) {
      throw workflowPinNotFound(run.workflow_tag, 0);
    }

    const pin = await this.resolvePin(
      writer,
      run.organization_id,
      run.workflow_tag,
      run.workflow_version_pin,
    );
    const stage = pin.stages.get(stageKey);

    if (stage === undefined) {
      throw stageNotInPin(stageKey, run.workflow_tag, run.workflow_version_pin);
    }

    return stage;
  }
}

/**
 * Row → resource, for a stage.
 *
 * A function rather than a method because it reaches for nothing: a `run_stages` row carries
 * everything the answer holds, including the `note` the database composed, and mapping it is
 * pure.
 *
 * @param stage - The row as it stands after the transition.
 * @returns What the caller is told.
 */
export function stageResource(stage: RunStage): StageTransitionResource {
  return {
    runStageId: stage.id,
    stageKey: stage.stage_key,
    stageLabel: stage.stage_label,
    position: stage.position,
    attempt: stage.attempt,
    maxAttempts: stage.max_attempts,
    tokenBudget: stage.token_budget,
    status: stage.status,
    note: stage.note,
    startedAt: stage.started_at?.toISOString() ?? null,
    finishedAt: stage.finished_at?.toISOString() ?? null,
    returnedFrom:
      stage.return_reason === null ||
      stage.returned_from_stage_key === null ||
      stage.returned_from_kind === null
        ? null
        : {
            stageKey: stage.returned_from_stage_key,
            kind: stage.returned_from_kind,
            reason: stage.return_reason,
          },
  };
}

/** Re-exported so `ingest.module.ts` binds the token without importing two files. */
export { GUARDRAIL_SCHEDULER };
