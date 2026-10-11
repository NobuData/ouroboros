/**
 * The lifecycle around the dry-run harness (CD.4,
 * [#562](https://github.com/NobuData/ouroboros/issues/562)).
 *
 * ```
 * start ─▶ workflow · draft at the named rev · ticket · its repository         (refusals: 404/409/422)
 *       ─▶ pin the commit the virtual workspace reads at                       (GitHub)
 *       ─▶ record the dry run, `precheck`
 *       ─▶ structural pre-check: the DSL validator, then the engine's (R.2, #144)
 *            ├─ findings ─▶ the run ends `failed` with them — **nothing is invoked**
 *            └─ green    ─▶ `running`
 *       ─▶ budget = min(workspace cap, the draft's spend guard)
 *       ─▶ resolve each model stage (routing, context assembly)
 *       ─▶ dispatch to the harness — and answer; the run goes on (dry-runs.runner.ts)
 * ```
 *
 * Four decisions:
 *
 *   * **The pre-check comes before anything that costs.** A disconnected stage or an invalid
 *     trigger is known in milliseconds; the record of a pre-check that failed is a `failed` dry
 *     run carrying anchored findings, and no model, estimator or repository read happened.
 *   * **A dry run tests the stored draft at the revision the caller named.** A draft that moved
 *     is a `409`, not a result about a document the caller never saw. A **re-run** names the
 *     draft's *current* revision — that is the point of it: Apply, re-run, see the change.
 *   * **One dry run per workflow at a time.** Real models are being paid for; a second start
 *     while one is open is a `409` naming the open run. A run left open by a process that died
 *     is reaped once it has outlived the harness's own deadline.
 *   * **Dry-run spend stays in the dry-run domain** (decision W4). The cost is recorded on
 *     `dry_runs` and summed for the history; nothing here writes a run, a stage or a usage row.
 */

import { Injectable, Logger } from "@nestjs/common";

import type { DryRun, Workflow } from "../db/schema";
import { DRY_RUN_TERMINAL_STATUSES } from "../db/schema";
import { EngineClient } from "../engine/engine.client";
import { ENGINE_DRY_RUN_TIMEOUT_MS, type EngineDryRunRequest } from "../engine/engine.dryruns";
import { describeForLog } from "../errors/failure";
import { validateWorkflowDocument } from "../workflows/dsl.validator";
import { fromDiagnostic, fromEngineFinding, type PublishFinding } from "../workflows/publish.gate";
import { draftAbsent, workflowNotFound } from "../workflows/workflows.errors";
import {
  draftSpendGuardCents,
  effectiveBudget,
  engineBudget,
  type DryRunBudget,
} from "./dry-runs.budget";
import { PinnedCommitReader } from "./dry-runs.commit";
import { DEFAULT_CANDIDATE_LIMIT, type StartDryRunBody } from "./dry-runs.dto";
import {
  dryRunDraftStale,
  dryRunInProgress,
  dryRunNotFound,
  dryRunNotRunning,
  dryRunRepositoryUnresolved,
  dryRunSessionMismatch,
  dryRunSourceUnsupported,
  dryRunTicketNotFound,
} from "./dry-runs.errors";
import { DryRunPickerService } from "./dry-runs.picker.service";
import { DryRunPlanService } from "./dry-runs.plans";
import { DryRunRecords } from "./dry-runs.records";
import { DryRunsRepository, isDryRunSource, type DryRunTicketRow } from "./dry-runs.repository";
import {
  dryRunCandidate,
  dryRunDraftLabel,
  dryRunHistory,
  dryRunStage,
  type DryRunCandidatesResource,
  type DryRunHistoryResource,
  type DryRunResource,
} from "./dry-runs.resources";
import { DryRunRunner } from "./dry-runs.runner";
import { safetyStrip, type DryRunSafetyResource } from "./dry-runs.safety";
import type { DryRunStreamEvent } from "./dry-runs.stream";

/** How many runs the history answers with. */
export const HISTORY_LIMIT = 50;

/** Why a run left open by a process that died is recorded as failed. */
export const INTERRUPTED = "The dry run was interrupted before it finished.";

/** Why a run whose dispatch could not be prepared is recorded as failed. */
export const DISPATCH_FAILED = "The dry run could not be dispatched.";

/** Why a run whose pre-check could not be run is recorded as failed. */
export const PRECHECK_UNAVAILABLE = "The structural pre-check could not be run.";

/**
 * The sentence a failed pre-check is recorded with.
 *
 * @param count - How many findings.
 * @returns The reason.
 */
export function precheckReason(count: number): string {
  return `The structural pre-check found ${String(count)} problem${count === 1 ? "" : "s"}; nothing was invoked.`;
}

@Injectable()
export class DryRunsService {
  private readonly logger = new Logger(DryRunsService.name);

  /**
   * @param dryRuns - The statements.
   * @param records - A dry run read back whole.
   * @param runner - The runs in flight.
   * @param commits - The commit a run pins, and the token it reads with.
   * @param planner - What each model stage is sent.
   * @param picker - The edge-case picker.
   * @param engine - The typed engine client — the pre-check and the harness description.
   */
  constructor(
    private readonly dryRuns: DryRunsRepository,
    private readonly records: DryRunRecords,
    private readonly runner: DryRunRunner,
    private readonly commits: PinnedCommitReader,
    private readonly planner: DryRunPlanService,
    private readonly picker: DryRunPickerService,
    private readonly engine: EngineClient,
  ) {}

  /**
   * Start a dry run of a workflow's draft against one ticket.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param workflowId - The workflow.
   * @param body - The ticket, the draft revision the caller is looking at, and the session.
   * @returns The dry run as recorded — `running` with its budget, or `failed` with the
   *   pre-check's findings.
   * @throws {NotFoundError} `workflow_not_found`, `dry_run_ticket_not_found`.
   * @throws {ConflictError} `workflow_draft_absent`, `dry_run_draft_stale`,
   *   `dry_run_in_progress`, and GitHub's `409` for a workspace with no token.
   * @throws {InvalidRequestError} `dry_run_source_unsupported`,
   *   `dry_run_repository_unresolved`, `dry_run_session_mismatch`.
   * @throws {UpstreamError} When GitHub could not name the commit, or the engine could not run
   *   the pre-check.
   */
  async start(
    organizationId: string,
    workflowId: string,
    body: StartDryRunBody,
  ): Promise<DryRunResource> {
    const workflow = await this.requireWorkflow(organizationId, workflowId);
    const definition = await this.dryRuns.draftDefinition(workflow.id);
    if (definition === undefined) throw draftAbsent(workflow.id);
    if (body.draftRev !== workflow.draft_rev) {
      throw dryRunDraftStale(body.draftRev, workflow.draft_rev);
    }

    const ticket = await this.dryRuns.ticket(organizationId, body.ticketId);
    if (ticket === undefined) throw dryRunTicketNotFound(body.ticketId);

    const sessionId = body.sessionId ?? null;
    if (
      sessionId !== null &&
      !(await this.dryRuns.sessionIsAbout(organizationId, workflow.id, sessionId))
    ) {
      throw dryRunSessionMismatch(sessionId);
    }

    return this.run(workflow, definition, ticket, sessionId);
  }

  /**
   * Run a finished dry run again — the same ticket, the draft **as it is now**.
   *
   * @param organizationId - The workspace.
   * @param workflowId - The workflow.
   * @param dryRunId - The dry run to repeat.
   * @returns The new dry run.
   * @throws {NotFoundError} `workflow_not_found`, `dry_run_not_found`.
   * @throws The refusals of {@link start}, less the stale draft: a re-run names no revision.
   */
  async rerun(
    organizationId: string,
    workflowId: string,
    dryRunId: string,
  ): Promise<DryRunResource> {
    const workflow = await this.requireWorkflow(organizationId, workflowId);
    const previous = await this.dryRuns.find(organizationId, workflow.id, dryRunId);
    if (previous === undefined) throw dryRunNotFound(dryRunId);

    const definition = await this.dryRuns.draftDefinition(workflow.id);
    if (definition === undefined) throw draftAbsent(workflow.id);

    const ticket = await this.dryRuns.ticket(organizationId, previous.ticket_id);
    if (ticket === undefined) throw dryRunTicketNotFound(previous.ticket_id);

    return this.run(workflow, definition, ticket, previous.session_id);
  }

  /**
   * Cancel a running dry run. The rows it reached are kept, and it ends `cancelled` — neither
   * failed nor budget-stopped.
   *
   * @param organizationId - The workspace.
   * @param workflowId - The workflow.
   * @param dryRunId - The dry run.
   * @returns The dry run as it ended.
   * @throws {NotFoundError} `workflow_not_found`, `dry_run_not_found`.
   * @throws {ConflictError} `dry_run_not_running` when it has already ended.
   */
  async cancel(
    organizationId: string,
    workflowId: string,
    dryRunId: string,
  ): Promise<DryRunResource> {
    const run = await this.requireRun(organizationId, workflowId, dryRunId);
    if (isTerminal(run)) throw dryRunNotRunning(run.id, run.status);

    return this.records.resource(await this.runner.cancel(run));
  }

  /**
   * One dry run, with everything recorded about it so far.
   *
   * @param organizationId - The workspace.
   * @param workflowId - The workflow.
   * @param dryRunId - The dry run.
   * @returns The resource.
   * @throws {NotFoundError} `workflow_not_found`, `dry_run_not_found`.
   */
  async detail(
    organizationId: string,
    workflowId: string,
    dryRunId: string,
  ): Promise<DryRunResource> {
    return this.records.resource(await this.requireRun(organizationId, workflowId, dryRunId));
  }

  /**
   * A workflow's dry-run history — the footer's `history: N dry runs · draft v0.3`.
   *
   * @param organizationId - The workspace.
   * @param workflowId - The workflow.
   * @returns The count, the workflow's dry-run spend and the runs, newest first.
   * @throws {NotFoundError} `workflow_not_found`.
   */
  async history(organizationId: string, workflowId: string): Promise<DryRunHistoryResource> {
    const workflow = await this.requireWorkflow(organizationId, workflowId);
    const [runs, spend] = await Promise.all([
      this.dryRuns.history(organizationId, workflow.id, HISTORY_LIMIT),
      this.dryRuns.spend(organizationId, workflow.id),
    ]);

    return dryRunHistory(workflow, runs, spend);
  }

  /**
   * The tickets most worth dry-running the draft against, ranked by how many of its
   * ticket-testing dimensions each mismatches (decision W8).
   *
   * @param organizationId - The workspace.
   * @param workflowId - The workflow.
   * @param limit - How many; {@link DEFAULT_CANDIDATE_LIMIT} when omitted.
   * @returns The ranked candidates, each with its reason.
   * @throws {NotFoundError} `workflow_not_found`.
   * @throws {ConflictError} `workflow_draft_absent`.
   */
  async candidates(
    organizationId: string,
    workflowId: string,
    limit: number = DEFAULT_CANDIDATE_LIMIT,
  ): Promise<DryRunCandidatesResource> {
    const workflow = await this.requireWorkflow(organizationId, workflowId);
    const definition = await this.dryRuns.draftDefinition(workflow.id);
    if (definition === undefined) throw draftAbsent(workflow.id);

    const ranked = await this.picker.rank(organizationId, definition, { limit });

    return {
      draftLabel: dryRunDraftLabel(workflow.current_version, workflow.draft_rev),
      candidates: ranked.map(dryRunCandidate),
    };
  }

  /**
   * The safety strip: three claims, each derived from the harness's own configuration.
   *
   * @param organizationId - The workspace.
   * @param workflowId - The workflow the page is about.
   * @returns The strip.
   * @throws {NotFoundError} `workflow_not_found`.
   * @throws {UpstreamError} `engine_unavailable` — a strip that cannot be derived is not shown.
   */
  async safety(organizationId: string, workflowId: string): Promise<DryRunSafetyResource> {
    await this.requireWorkflow(organizationId, workflowId);

    return safetyStrip(await this.engine.dryRunHarness());
  }

  /**
   * Follow one dry run: its events so far, then each as it happens, ending after `done`.
   *
   * A run this process is holding is followed live. Any other — finished, or held elsewhere —
   * is read from the record: its rows as `stage_finished`, then `done` when it has ended.
   *
   * @param organizationId - The workspace.
   * @param workflowId - The workflow.
   * @param dryRunId - The dry run.
   * @param signal - Ends the subscription — the client went away.
   * @yields `accepted` first; `done` last once the run has ended.
   * @throws {NotFoundError} `workflow_not_found`, `dry_run_not_found` — before anything is
   *   yielded, so a refusal is an ordinary error envelope.
   */
  async *events(
    organizationId: string,
    workflowId: string,
    dryRunId: string,
    signal?: AbortSignal,
  ): AsyncGenerator<DryRunStreamEvent> {
    const run = await this.requireRun(organizationId, workflowId, dryRunId);

    if (this.runner.isLive(run.id)) {
      const followed = yield* this.runner.follow(run.id, signal);
      if (followed) return;
    }

    const stored = (await this.dryRuns.find(organizationId, workflowId, dryRunId)) ?? run;
    const resource = await this.records.resource(stored);

    yield { kind: "accepted", dryRun: resource };
    for (const stage of await this.dryRuns.stages(stored.id)) {
      yield { kind: "stage_finished", stage: dryRunStage(stage) };
    }
    if (isTerminal(stored)) yield { kind: "done", dryRun: resource };
  }

  /**
   * Everything after the refusals: pin, record, pre-check, budget, plans, dispatch.
   *
   * @param workflow - The workflow.
   * @param definition - Its stored draft.
   * @param ticket - The ticket.
   * @param sessionId - The copilot session, or `null`.
   * @returns The dry run as recorded.
   */
  private async run(
    workflow: Workflow,
    definition: unknown,
    ticket: DryRunTicketRow,
    sessionId: string | null,
  ): Promise<DryRunResource> {
    const organizationId = workflow.organization_id;

    if (!isDryRunSource(ticket.source_kind)) {
      throw dryRunSourceUnsupported(ticket.external_key, ticket.source_kind);
    }
    if (ticket.repo_owner === null || ticket.repo_name === null) {
      throw dryRunRepositoryUnresolved(ticket.external_key);
    }

    await this.refuseWhileOpen(workflow.id);

    const commit = await this.commits.pin(
      organizationId,
      ticket.repo_owner,
      ticket.repo_name,
      ticket.repo_default_branch,
    );
    const recorded = await this.dryRuns.insert({
      organizationId,
      workflowId: workflow.id,
      baseVersion: workflow.current_version,
      draftRev: workflow.draft_rev,
      sessionId,
      ticketId: ticket.id,
      pinnedSha: commit.sha,
    });

    const findings = await this.precheck(recorded, definition);
    if (findings.length > 0) {
      return this.records.resource(
        await this.dryRuns.failPrecheck(recorded.id, findings, precheckReason(findings.length)),
      );
    }

    const running = await this.dryRuns.markRunning(recorded.id);
    let budget: DryRunBudget;
    let request: EngineDryRunRequest;
    try {
      budget = effectiveBudget(
        await this.dryRuns.workspaceCapCents(organizationId),
        draftSpendGuardCents(await this.dryRuns.guardTraces(organizationId, workflow.id)),
      );
      request = {
        dryRun: running.id,
        definition,
        ticket: {
          externalKey: ticket.external_key,
          source: ticket.source_kind,
          labels: ticket.labels,
          estimate: ticket.effort === null ? null : { effort: ticket.effort },
          title: ticket.title,
          body: ticket.body ?? "",
        },
        repository: { slug: commit.slug, pinnedSha: commit.sha, token: commit.token },
        stages: await this.planner.plans(
          {
            organizationId,
            workflowSlug: workflow.slug,
            repository: commit.slug,
            labels: ticket.labels,
            effort: ticket.effort,
          },
          definition,
        ),
        budget: engineBudget(budget),
      };
    } catch (error) {
      // The run is recorded and open; it must not be left that way by a dispatch that never
      // happened.
      await this.dryRuns.finish(running.id, {
        status: "failed",
        failureReason: DISPATCH_FAILED,
        durationMs: null,
        costCents: null,
        tokens: null,
        guardAudit: [],
      });
      throw error;
    }

    await this.runner.launch(running, request, budget);

    return this.records.resource(running, budget);
  }

  /**
   * The structural pre-check: this service's DSL validator, then the engine's (R.2, #144).
   *
   * The cheap one first, and a document that fails it never reaches the engine — the publish
   * gate's order, for its reasons. Unlike a publish, an unresolved alias, skill or task kind is
   * **not** a finding here: the dry run skips such a stage honestly (decision W7).
   *
   * @param run - The recorded run, `precheck`.
   * @param definition - The draft's document.
   * @returns The anchored findings — empty is the green verdict.
   * @throws {UpstreamError} `engine_unavailable` — after the run is ended `failed`, so no
   *   record is left in `precheck`.
   */
  private async precheck(run: DryRun, definition: unknown): Promise<PublishFinding[]> {
    const verdict = validateWorkflowDocument(definition);
    if (!verdict.valid) return verdict.errors.map(fromDiagnostic);

    try {
      return (await this.engine.validateWorkflow(definition)).findings.map(fromEngineFinding);
    } catch (error) {
      await this.dryRuns.failPrecheck(run.id, [], PRECHECK_UNAVAILABLE);
      throw error;
    }
  }

  /**
   * Refuse a start while the workflow has an open dry run — unless that run was left behind.
   *
   * A run this process is not holding, older than the harness's own deadline, cannot still be
   * running anywhere; it is ended `failed` and the start goes on.
   *
   * @param workflowId - The workflow.
   * @throws {ConflictError} `dry_run_in_progress`.
   */
  private async refuseWhileOpen(workflowId: string): Promise<void> {
    const open = await this.dryRuns.open(workflowId);
    if (open === undefined) return;

    const age = Date.now() - open.started_at.getTime();
    if (this.runner.isLive(open.id) || age <= ENGINE_DRY_RUN_TIMEOUT_MS) {
      throw dryRunInProgress(open.id);
    }

    this.logger.warn(`dry run ${open.id} was left open by a process that stopped; ending it`);
    try {
      await (open.status === "precheck"
        ? this.dryRuns.failPrecheck(open.id, [], INTERRUPTED)
        : this.dryRuns.finish(open.id, {
            status: "failed",
            failureReason: INTERRUPTED,
            durationMs: null,
            costCents: null,
            tokens: null,
            guardAudit: [],
          }));
    } catch (error) {
      this.logger.error(`dry run ${open.id} could not be ended`, describeForLog(error));
      throw dryRunInProgress(open.id);
    }
  }

  /**
   * The workflow, or a `404`.
   *
   * @param organizationId - The workspace.
   * @param workflowId - The workflow.
   * @returns The row.
   * @throws {NotFoundError} `workflow_not_found`.
   */
  private async requireWorkflow(organizationId: string, workflowId: string): Promise<Workflow> {
    const workflow = await this.dryRuns.workflow(organizationId, workflowId);
    if (workflow === undefined) throw workflowNotFound(workflowId);

    return workflow;
  }

  /**
   * One dry run of a workflow, or a `404`.
   *
   * @param organizationId - The workspace.
   * @param workflowId - The workflow.
   * @param dryRunId - The dry run.
   * @returns The row.
   * @throws {NotFoundError} `workflow_not_found`, `dry_run_not_found`.
   */
  private async requireRun(
    organizationId: string,
    workflowId: string,
    dryRunId: string,
  ): Promise<DryRun> {
    const workflow = await this.requireWorkflow(organizationId, workflowId);
    const run = await this.dryRuns.find(organizationId, workflow.id, dryRunId);
    if (run === undefined) throw dryRunNotFound(dryRunId);

    return run;
  }
}

/**
 * Whether a dry run has ended.
 *
 * @param run - The row.
 * @returns `true` for `complete`, `failed`, `budget_stopped` and `cancelled`.
 */
function isTerminal(run: Pick<DryRun, "status">): boolean {
  return (DRY_RUN_TERMINAL_STATUSES as readonly string[]).includes(run.status);
}
