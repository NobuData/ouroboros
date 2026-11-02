/**
 * The engine executes a run — #160's control-plane half of ADR decision A
 * (`docs/DECISION_EXECUTION_ENGINE.md` § The decision).
 *
 * ```
 * POST /internal/runs/:id/start       {worker}                  → epoch + everything to execute
 *   404 run_not_found · 409 run_simulated · 409 run_not_executable
 * POST /internal/runs/:id/heartbeat   {epoch}                   → {epoch, heartbeat_at}
 *   409 fenced · 409 run_not_executable
 * PUT  /internal/runs/:id/checkpoint  {epoch, base_commit?, state} → {checkpoint_at}
 *   409 fenced · 409 base_commit_mismatch · 409 run_not_executable
 * POST /internal/runs/:id/finish      {epoch, idempotency_key, outcome, reason, stage_key?}
 *   409 fenced · 409 run_not_executable · 409 idempotency_key_reused
 * ```
 *
 * **The epoch is the fence.** A start raises `runs.exec_epoch` under the run's lock and answers
 * it; every later write — these three and the six AP.1 reports (`ingest.fence.ts`) — carries it,
 * and one that is not the run's current epoch is refused `409 fenced`. So when the supervisor
 * resubmits a run whose worker went quiet and a second worker starts it, the first can no longer
 * write into it, even if it was only slow rather than dead.
 *
 * **Finishing is a slice terminal.** `review` (the PR stage is DI.2/DI.3's) keeps the run in
 * flight; `needs_human` rests it and files the inbox card through `RunNeedsHumanEmitter`;
 * `failed` rests it; `back_to_queue` rests it as `failed` and puts the issue back at the tail of
 * the queue, unconfirmed. The reason is written to the transcript as a `system` line — `runs` has
 * no reason column, and the transcript is where a run's story is told.
 */

import { Injectable, Logger } from "@nestjs/common";

import type { Run } from "../db/schema";
import { describeForLog } from "../errors/failure";
import { DomainError } from "../errors/error.envelope";
import { GuardrailService } from "../guardrails/guardrails.service";
import { CodeWorkspace } from "../research/code/code.workspace";
import type { Resolution } from "../routing/resolution";
import { ResolutionService } from "../routing/resolution.service";
import { ROUTING_ERRORS } from "../routing/routing.errors";
import {
  baseCommitMismatch,
  repositoryNotFound,
  runNotExecutable,
  runNotFound,
  runSimulated,
  workflowPinNotFound,
} from "./ingest.errors";
import { assertEpoch } from "./ingest.fence";
import { requestDigest } from "./ingest.idempotency";
import { commitReceipt, replayedReceipt, type ReceiptScope } from "./ingest.receipts";
import { IngestRepository, type Writer } from "./ingest.repository";
import { EXECUTABLE_RUN_STATUSES, RunExecutionRepository } from "./run-execution.repository";
import type {
  CheckpointRunDto,
  FinishOutcome,
  FinishRunDto,
  HeartbeatDto,
  StartRunDto,
} from "./run-execution.dto";
import type {
  CheckpointSavedResource,
  HeartbeatResource,
  RunFinishedResource,
  RunStartedResource,
} from "./run-execution.resources";
import { RunNeedsHumanEmitter } from "./run-needs-human.emitter";
import { taskModels } from "./run-task-models";

/** Where each finish outcome leaves the run. */
export const FINISH_STATUS = {
  review: "review",
  needs_human: "needs_human",
  failed: "failed",
  back_to_queue: "failed",
} as const satisfies Record<FinishOutcome, "review" | "needs_human" | "failed">;

@Injectable()
export class RunExecutionService {
  /** Where a card the needs-human emitter could not file is reported. */
  private readonly logger = new Logger(RunExecutionService.name);

  /**
   * @param runs - The ingest contract's statements: the run's lock, the pin and the ledger.
   * @param execution - The execution columns, the requeue and the supervisor's reads.
   * @param code - How the engine fetches a repository — the token opened per call.
   * @param guardrails - The effective protected-path globs (AP.3 + BQ.2's union).
   * @param needsHuman - Files the inbox card when a run hands itself to a person.
   */
  constructor(
    private readonly runs: IngestRepository,
    private readonly execution: RunExecutionRepository,
    private readonly code: CodeWorkspace,
    private readonly guardrails: GuardrailService,
    private readonly needsHuman: RunNeedsHumanEmitter,
    private readonly resolutions: ResolutionService,
  ) {}

  /**
   * Routing's resolution of one task kind in a workspace, for the start answer's `task_models`.
   *
   * @param organizationId - The run's workspace.
   * @param taskKind - The task kind a stage inherits.
   * @returns The resolution, or `null` when the workspace routes no such task.
   */
  private async routedTask(organizationId: string, taskKind: string): Promise<Resolution | null> {
    try {
      return await this.resolutions.resolve(organizationId, taskKind);
    } catch (error) {
      if (error instanceof DomainError && error.envelope().code === ROUTING_ERRORS.routeNotFound) {
        return null;
      }

      throw error;
    }
  }

  /**
   * Start (or restart) executing a run: take a new epoch, and answer everything the interpreter
   * needs — the pinned document, the repository and how to fetch it, the protected paths, the
   * ticket and its imported acceptance criteria (#1308), and the base commit and checkpoint a
   * restart resumes from.
   *
   * The epoch, the worker, the heartbeat and the branch are written in one transaction with the
   * reads that could refuse the start, so a refused start takes no epoch. The repository's token
   * is opened afterwards, outside the transaction, because it can be a network call.
   *
   * @param run - The run.
   * @param request - The worker starting it.
   * @returns The new epoch and the run's execution context.
   * @throws {NotFoundError} `404 run_not_found`, `404 workflow_pin_not_found`,
   *   `404 repository_not_found`.
   * @throws {ConflictError} `409 run_simulated` — only live runs execute; `409
   *   run_not_executable` — the run is not `coding` or `building`.
   */
  async start(run: string, request: StartRunDto): Promise<RunStartedResource> {
    const context = await this.runs.transaction(async (trx) => {
      const row = await this.locked(trx, run);

      if (row.origin !== "live" || row.simulated) {
        throw runSimulated(run, row.origin);
      }

      assertExecutable(row);

      const started = await this.execution.start(trx, run, request.worker);
      const version = started.workflow_version_pin;
      const pinned =
        version === null
          ? undefined
          : await this.runs.pinnedDefinition(
              trx,
              started.organization_id,
              started.workflow_tag,
              version,
            );

      if (version === null || pinned === undefined) {
        throw workflowPinNotFound(started.workflow_tag, version ?? 0);
      }

      const repository = await this.execution.repositoryOf(trx, started);

      if (repository === undefined) {
        throw repositoryNotFound(started.github_repo_id);
      }

      const ticket = await this.execution.ticketOf(trx, started);
      const criteria = await this.execution.acceptanceCriteriaOf(trx, started, ticket.id);
      const estimate = await this.execution.latestEstimate(trx, started);
      const starter = await this.execution.starterOf(trx, started);
      const protectedPaths = await this.guardrails.effectiveProtectedPaths(trx, {
        organizationId: started.organization_id,
        githubRepoId: started.github_repo_id,
        issueNumber: started.issue_number,
        workflowTag: started.workflow_tag,
        workflowVersionPin: version,
      });

      return {
        started,
        version,
        document: pinned.definition,
        repository,
        ticket,
        criteria,
        effort: estimate?.effort ?? null,
        starter,
        protectedPaths,
      };
    });

    const { started, repository } = context;
    const ref = await this.code.repositoryRef(started.organization_id, repository);
    const models = await taskModels(context.document, (taskKind) =>
      this.routedTask(started.organization_id, taskKind),
    );

    return {
      run_id: started.id,
      epoch: started.exec_epoch,
      organization_id: started.organization_id,
      issue_number: started.issue_number,
      issue_title: started.issue_title,
      issue_body: context.ticket.body,
      labels: [...context.ticket.labels],
      effort: context.effort,
      acceptance_criteria: context.criteria.map(({ id, text }) => ({ id, text })),
      model: started.model,
      task_models: models,
      started_by: context.starter ?? null,
      // Set by the start when the run had none, so never null here.
      branch_name: started.branch_name ?? "",
      workflow: { tag: started.workflow_tag, version: context.version, document: context.document },
      repository: {
        id: repository.id,
        slug: repository.slug,
        default_branch: repository.defaultBranch,
        ref,
      },
      protected_paths: context.protectedPaths,
      base_commit: started.exec_base_commit,
      checkpoint: started.exec_checkpoint,
      status: started.status,
    };
  }

  /**
   * The worker holding the epoch is still executing the run.
   *
   * @param run - The run.
   * @param request - The epoch the worker holds.
   * @returns The epoch and when the heartbeat was stamped.
   * @throws {NotFoundError} `404 run_not_found`.
   * @throws {ConflictError} `409 fenced` — another start took the run; `409 run_not_executable`
   *   — it finished or a person cancelled it. Either way the engine stops.
   */
  async heartbeat(run: string, request: HeartbeatDto): Promise<HeartbeatResource> {
    return this.runs.transaction(async (trx) => {
      const row = await this.locked(trx, run);

      assertEpoch(row, request.epoch);
      assertExecutable(row);

      const at = await this.execution.heartbeat(trx, run);

      return { epoch: row.exec_epoch, heartbeat_at: at.toISOString() };
    });
  }

  /**
   * Save the interpreter's resume state, and the base commit the first time it is named.
   * Refreshes the heartbeat too: a checkpoint is the worker being heard from.
   *
   * @param run - The run.
   * @param request - The epoch, the state, and optionally the base commit.
   * @returns When the checkpoint was written.
   * @throws {NotFoundError} `404 run_not_found`.
   * @throws {ConflictError} `409 fenced`, `409 run_not_executable`, `409 base_commit_mismatch`
   *   — the run's base commit is already another commit.
   */
  async checkpoint(run: string, request: CheckpointRunDto): Promise<CheckpointSavedResource> {
    return this.runs.transaction(async (trx) => {
      const row = await this.locked(trx, run);

      assertEpoch(row, request.epoch);
      assertExecutable(row);

      const offered = request.base_commit;
      if (
        offered !== undefined &&
        row.exec_base_commit !== null &&
        row.exec_base_commit !== offered
      ) {
        throw baseCommitMismatch(row.exec_base_commit, offered);
      }

      const at = await this.execution.checkpoint(
        trx,
        run,
        request.state,
        row.exec_base_commit === null ? offered : undefined,
      );

      return { checkpoint_at: at.toISOString() };
    });
  }

  /**
   * End the run through one of the workflow's terminals. Idempotent on `idempotency_key`: a
   * replay answers what the first delivery was told, even once the run has finished.
   *
   * Order, as on every keyed write here: lock, fence, replay, refuse, work, receipt. The fence is
   * before the replay so a worker that lost the run is never told a write succeeded; the
   * executable check is after it so a retried finish answers rather than being refused by the
   * finish it is retrying.
   *
   * @param run - The run.
   * @param request - The epoch, the key, the outcome, the reason and the stage it ended at.
   * @returns The run's new status, and the queue item a `back_to_queue` finish wrote.
   * @throws {NotFoundError} `404 run_not_found`.
   * @throws {ConflictError} `409 fenced`, `409 run_not_executable` — it is already finished or
   *   in review; `409 idempotency_key_reused`.
   */
  async finish(run: string, request: FinishRunDto): Promise<RunFinishedResource> {
    const digest = requestDigest(request);

    const { resource, emit } = await this.runs.transaction(async (trx) => {
      const row = await this.locked(trx, run);

      assertEpoch(row, request.epoch);

      const scope: ReceiptScope = {
        organizationId: row.organization_id,
        operation: "run.finish",
        idempotencyKey: request.idempotency_key,
        digest,
      };
      const replay = await replayedReceipt<RunFinishedResource>(this.runs, trx, scope);

      if (replay.replayed) {
        return { resource: replay.response, emit: false };
      }

      assertExecutable(row);

      const status = FINISH_STATUS[request.outcome];
      await this.execution.finish(trx, run, status);
      await this.execution.appendFinishEvent(trx, run, request.reason, {
        outcome: request.outcome,
        ...(request.stage_key === undefined ? {} : { stage_key: request.stage_key }),
      });

      const requeued =
        request.outcome === "back_to_queue" ? await this.execution.requeue(trx, row) : undefined;

      const answered = await commitReceipt<RunFinishedResource>(this.runs, trx, scope, run, {
        run_id: run,
        status,
        requeued_queue_item_id: requeued?.id ?? null,
      });

      return { resource: answered, emit: status === "needs_human" };
    });

    // After the commit: the emitter reads the run's status on its own connection, and a card
    // that could not be filed must not undo a finish that happened.
    if (emit) {
      try {
        await this.needsHuman.handedOver(run, request.reason);
      } catch (error) {
        this.logger.error(
          `Run ${run} needs a person, and its inbox card could not be filed.`,
          describeForLog(error),
        );
      }
    }

    return resource;
  }

  /**
   * The run, locked for the rest of the transaction.
   *
   * @param writer - The transaction.
   * @param run - The run's id.
   * @returns The row.
   * @throws {NotFoundError} `404 run_not_found`.
   */
  private async locked(writer: Writer, run: string): Promise<Run> {
    const row = await this.runs.lockRun(writer, run);

    if (row === undefined) {
      throw runNotFound(run);
    }

    return row;
  }
}

/**
 * Refuse to execute a run that is not `coding` or `building`.
 *
 * @param run - The run, locked.
 * @throws {ConflictError} `409 run_not_executable`.
 */
function assertExecutable(run: Pick<Run, "id" | "status">): void {
  if (!(EXECUTABLE_RUN_STATUSES as readonly string[]).includes(run.status)) {
    throw runNotExecutable(run.id, run.status);
  }
}
