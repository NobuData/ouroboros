/**
 * Classification & routing — the Mark & Route card's control surface. AT.4
 * ([#332](https://github.com/NobuData/ouroboros/issues/332)), decisions **T6** and **T7**, option
 * **5-A**.
 *
 * ```
 * GET  /api/v1/test-runs/:id/hints                     heuristic hints, every rule's verdict
 * GET  /api/v1/test-runs/:id/classifications           each case's current decision + receipt
 * POST /api/v1/test-runs/:id/cases/:caseId/classify    record a decision, then route it
 * POST /api/v1/test-runs/:id/rerun                     Re-run failed (N) / Re-run full suite
 * POST /api/v1/test-runs/:id/waivers                   the waiver half of Waive & annotate PR
 * ```
 *
 * ---------------------------------------------------------------------------
 * **The actions compose over machinery that already exists** (decision T6). Nothing here is a
 * second way to nudge a loop or to start a build:
 *
 * ```
 * class                        route             composes
 * product_bug | test_update    correction_round  AP.4's control queue: a steer carrying the note,
 *                                                with retry_stage (V061) — the executor puts the
 *                                                note in the planning context and starts the
 *                                                stage's next attempt. Receipt: control_id +
 *                                                target_attempt.
 * flake_retry                  flake_retry       a history mark (V054) + AH.4's dispatch: a re-run
 *                                                of the case, as a new build. Receipt: rerun_job_id.
 * infra_rig                    infra_rig         the runner's farm health note (V061), and — when
 *                                                the card asks — a requeue of the attempt through
 *                                                AH.4. Receipt: rerun_job_id when requeued.
 * ```
 *
 * **A decision is recorded before it is routed**, and routing that cannot happen is said rather
 * than thrown: an attempt that no farm build produced has nothing to re-run, and the answer's
 * `skipped` says so beside a classification that was still made. The receipt holds only what was
 * actually dispatched, and V055 lets it be written once.
 *
 * **Every classification and every dispatch is audited with the person as the actor** —
 * `triage.classified`, `triage.rerun_requested`, `triage.waived` and `runner.flagged` here; the
 * control's own rows by V048's trigger; the build's `runner.job_submitted` by AH.4.
 */

import { Injectable } from "@nestjs/common";

import { AuditService } from "../audit/audit.service";
import {
  RUNNER_FLAGGED_EVENT,
  TRIAGE_CLASSIFIED_EVENT,
  TRIAGE_RERUN_REQUESTED_EVENT,
  TRIAGE_WAIVED_EVENT,
} from "../audit/audit.events";
import { ControlsService, type Requester } from "../controls/controls.service";
import type { ClassificationReceipt, FailureClass, TestSelectionScope } from "../db/schema";
import { DomainError } from "../errors/error.envelope";
import { FarmJobsService } from "../farm/dispatch/jobs.service";
import { heuristicTriageResponse } from "./triage.contract";
import type { ClassifyCaseDto, WaiveDto } from "./triage.dto";
import {
  classificationNoteRequired,
  classificationToggleInvalid,
  rerunNothingSelected,
  rerunSourceMissing,
  testCaseNotFailing,
  testCaseNotFound,
  testRunNotFound,
  waiverCasesInvalid,
} from "./triage.errors";
import {
  FAILED_STATUSES,
  FAILING_STATUSES,
  TriageRepository,
  type AttemptRow,
  type CaseRow,
} from "./triage.repository";
import {
  classificationResource,
  waiverResource,
  type ClassificationsListResource,
  type ClassifyResultResource,
  type RerunResource,
  type Route,
  type RoutingResource,
  type TestRunHintsResource,
  type WaiverResource,
} from "./triage.resources";
import { evaluateHints } from "./triage.rules";

/** Which composition each class routes to (decision T7). */
export const ROUTES: Readonly<Record<FailureClass, Route>> = {
  product_bug: "correction_round",
  test_update: "correction_round",
  flake_retry: "flake_retry",
  infra_rig: "infra_rig",
};

/** The classes whose route is a correction round, and so need a note to steer with. */
const CORRECTION_CLASSES: readonly FailureClass[] = ["product_bug", "test_update"];

@Injectable()
export class TriageService {
  /**
   * @param triage - Every statement this service issues.
   * @param controls - AP.4's queue, for the correction round.
   * @param jobs - AH.4's dispatch, for re-runs.
   * @param audit - AD.4's trail.
   */
  constructor(
    private readonly triage: TriageRepository,
    private readonly controls: ControlsService,
    private readonly jobs: FarmJobsService,
    private readonly audit: AuditService,
  ) {}

  // --- GET hints ---------------------------------------------------------------------------

  /**
   * The heuristic hint for every failing case of an attempt.
   *
   * @param organizationId - The workspace.
   * @param testRunId - The attempt.
   * @returns One entry per failed, error or flaky case.
   * @throws {NotFoundError} `404 test_run_not_found`.
   */
  async hints(organizationId: string, testRunId: string): Promise<TestRunHintsResource> {
    const attempt = await this.attemptOrThrow(organizationId, testRunId);
    const cases = await this.triage.cases(organizationId, testRunId, {
      statuses: FAILING_STATUSES,
    });
    const [dossiers, job] = await Promise.all([
      this.triage.dossiers(organizationId, attempt, cases),
      this.triage.job(organizationId, attempt.build_job_id),
    ]);

    return {
      testRunId,
      cases: cases.map((row) => {
        const dossier = dossiers.get(row.id);

        if (dossier === undefined) {
          throw new Error(`the dossier of case ${row.id} was not gathered`);
        }

        const previous = dossier.priorAttempts.at(-1);
        const evaluation = evaluateHints({
          status: row.status,
          retryOutcomes: row.retry_outcomes,
          failure: row.failure,
          priorPassOnRetry: dossier.flakeHistory.pass_on_retry,
          job: job === undefined ? null : { status: job.status, runnerStatus: job.runner_status },
          previous: previous === undefined ? null : previous.outcome,
          changedPaths: dossier.changedFiles.map((file) => file.path),
        });

        return {
          caseId: row.id,
          caseKey: row.case_key,
          name: row.name,
          suite: row.suite,
          status: row.status,
          hint: evaluation.hint,
          rules: evaluation.rules,
          triage:
            evaluation.hint === null ? null : heuristicTriageResponse(evaluation.hint, dossier),
        };
      }),
    };
  }

  // --- GET classifications -----------------------------------------------------------------

  /**
   * Each classified case's current decision, with its receipt.
   *
   * @param organizationId - The workspace.
   * @param testRunId - The attempt.
   * @returns The decisions.
   * @throws {NotFoundError} `404 test_run_not_found`.
   */
  async classifications(
    organizationId: string,
    testRunId: string,
  ): Promise<ClassificationsListResource> {
    await this.attemptOrThrow(organizationId, testRunId);

    const rows = await this.triage.classifications(organizationId, testRunId);

    return { testRunId, classifications: rows.map(classificationResource) };
  }

  // --- POST classify -----------------------------------------------------------------------

  /**
   * Record a person's classification of a failing case, then route it.
   *
   * @param organizationId - The workspace.
   * @param testRunId - The attempt.
   * @param caseId - The case.
   * @param requester - Who decided, and their roles (a steer is a member's).
   * @param request - The class, note, subtype and toggles.
   * @returns The classification with its receipt, and what routing did.
   * @throws {InvalidRequestError} `422 classification_note_required`,
   *   `422 classification_toggle_invalid`.
   * @throws {NotFoundError} `404 test_run_not_found`, `404 test_case_not_found`.
   * @throws {ConflictError} `409 test_case_not_failing`.
   */
  async classify(
    organizationId: string,
    testRunId: string,
    caseId: string,
    requester: Requester,
    request: ClassifyCaseDto,
  ): Promise<ClassifyResultResource> {
    if (CORRECTION_CLASSES.includes(request.class) && request.note === undefined) {
      throw classificationNoteRequired(request.class);
    }

    if (request.toggles?.requeue === true && request.class !== "infra_rig") {
      throw classificationToggleInvalid("requeue", request.class);
    }

    const attempt = await this.attemptOrThrow(organizationId, testRunId);
    const [row] = await this.triage.cases(organizationId, testRunId, { caseId });

    if (row === undefined) throw testCaseNotFound(testRunId, caseId);
    if (!FAILING_STATUSES.includes(row.status)) throw testCaseNotFailing(caseId, row.status);

    const recorded = await this.triage.transaction(async (trx) => {
      const inserted = await this.triage.insertClassification(trx, {
        organizationId,
        testCaseId: caseId,
        class: request.class,
        subtype: request.subtype ?? null,
        note: request.note ?? null,
        createdBy: requester.id,
      });
      const { blockUntilGreen, autoRerunPhysical } = request.toggles ?? {};

      if (blockUntilGreen !== undefined || autoRerunPhysical !== undefined) {
        await this.triage.upsertIntents(
          trx,
          organizationId,
          attempt.run_id,
          { blockUntilGreen, autoRerunPhysical },
          requester.id,
        );
      }

      return inserted;
    });

    const routing = await this.route(organizationId, attempt, row, requester, request, recorded.id);
    const receipt = receiptOf(routing);
    const classification =
      receipt === null ? recorded : await this.triage.route(organizationId, recorded.id, receipt);

    await this.audit.record({
      organizationId,
      actorId: requester.id,
      action: TRIAGE_CLASSIFIED_EVENT,
      subjectType: "test_case",
      subjectId: caseId,
      at: classification.created_at,
      detail: {
        classification_id: classification.id,
        class: classification.class,
        ...(classification.subtype === null ? {} : { subtype: classification.subtype }),
        test_run_id: testRunId,
        run_id: attempt.run_id,
        route: routing.route,
        ...(receipt === null ? {} : flatReceipt(receipt)),
      },
    });

    return { classification: classificationResource(classification), routing };
  }

  // --- POST rerun ------------------------------------------------------------------------

  /**
   * *Re-run failed* or *Re-run full suite*: a new build attempt carrying the case set.
   *
   * @param organizationId - The workspace.
   * @param testRunId - The attempt.
   * @param requester - Who asked.
   * @param scope - `failed` or `full`.
   * @returns The job and its honest queue state.
   * @throws {NotFoundError} `404 test_run_not_found`.
   * @throws {ConflictError} `409 rerun_nothing_selected`, `409 rerun_source_missing`, and the
   *   farm's own refusals (`farm_pool_disabled`).
   */
  async rerun(
    organizationId: string,
    testRunId: string,
    requester: Requester,
    scope: TestSelectionScope,
  ): Promise<RerunResource> {
    const attempt = await this.attemptOrThrow(organizationId, testRunId);
    const cases = await this.triage.cases(
      organizationId,
      testRunId,
      scope === "failed" ? { statuses: FAILED_STATUSES } : {},
    );
    const rerun = await this.dispatch(organizationId, requester.id, attempt, scope, cases);

    await this.audit.record({
      organizationId,
      actorId: requester.id,
      action: TRIAGE_RERUN_REQUESTED_EVENT,
      subjectType: "test_run",
      subjectId: testRunId,
      at: new Date(rerun.job.queuedAt),
      detail: {
        run_id: attempt.run_id,
        scope,
        cases: rerun.caseKeys.length,
        job_id: rerun.job.id,
        queue_state: rerun.queueState,
      },
    });

    return rerun;
  }

  // --- POST waivers ------------------------------------------------------------------------

  /**
   * Record a waiver — the author and the reason, never a PR annotation (AV.2, #344).
   *
   * @param organizationId - The workspace.
   * @param testRunId - The attempt it is recorded from.
   * @param authorId - The administrator waiving.
   * @param request - The reason and the waived cases.
   * @returns The waiver, `pending_pr_plane`.
   * @throws {NotFoundError} `404 test_run_not_found`.
   * @throws {InvalidRequestError} `422 waiver_cases_invalid`.
   */
  async waive(
    organizationId: string,
    testRunId: string,
    authorId: string,
    request: WaiveDto,
  ): Promise<WaiverResource> {
    const attempt = await this.attemptOrThrow(organizationId, testRunId);
    const wanted = [...new Set(request.caseIds ?? [])];
    const cases = wanted.length === 0 ? [] : await this.triage.cases(organizationId, testRunId);
    const found = new Map(cases.map((row) => [row.id, row.case_key]));
    const missing = wanted.filter((id) => !found.has(id));

    if (missing.length > 0) throw waiverCasesInvalid(missing);

    const caseKeys = [...new Set(wanted.map((id) => found.get(id) as string))];
    const waiver = await this.triage.insertWaiver(
      organizationId,
      attempt.run_id,
      authorId,
      request.reason,
      caseKeys,
    );

    await this.audit.record({
      organizationId,
      actorId: authorId,
      action: TRIAGE_WAIVED_EVENT,
      subjectType: "pr_waiver",
      subjectId: waiver.id,
      at: waiver.created_at,
      detail: { run_id: attempt.run_id, test_run_id: testRunId, cases: caseKeys.length },
    });

    return waiverResource(waiver, testRunId);
  }

  // --- routing -----------------------------------------------------------------------------

  /**
   * Route a recorded classification (decision T7).
   *
   * @param organizationId - The workspace.
   * @param attempt - The attempt.
   * @param row - The classified case.
   * @param requester - Who decided.
   * @param request - The decision.
   * @param classificationId - Its row, which names the correction round's idempotency key.
   * @returns What routing did.
   */
  private async route(
    organizationId: string,
    attempt: AttemptRow,
    row: CaseRow,
    requester: Requester,
    request: ClassifyCaseDto,
    classificationId: string,
  ): Promise<RoutingResource> {
    const route = ROUTES[request.class];
    const base: RoutingResource = {
      route,
      control: null,
      targetAttempt: null,
      historyMarked: null,
      rerun: null,
      runnerFlag: null,
      skipped: [],
    };

    switch (route) {
      case "correction_round": {
        const stage = await this.triage.currentStage(attempt.run_id);
        const control = await this.controls.correctionRound(
          organizationId,
          attempt.run_id,
          requester,
          request.note as string,
          `classification:${classificationId}`,
        );
        const queued = control.state !== "rejected";

        return {
          ...base,
          control,
          targetAttempt: queued && stage !== undefined ? stage.attempt + 1 : null,
          skipped: queued
            ? []
            : [
                `The run has finished, so no correction round was queued: ${control.detail ?? "rejected"}.`,
              ],
        };
      }

      case "flake_retry": {
        const historyMarked = await this.triage.markHistory(organizationId, row.id);
        const { rerun, skipped } = await this.tryDispatch(
          organizationId,
          requester.id,
          attempt,
          "failed",
          [row],
        );

        return { ...base, historyMarked, rerun, skipped };
      }

      case "infra_rig": {
        const skipped: string[] = [];
        const job = await this.triage.job(organizationId, attempt.build_job_id);
        let runnerFlag: RoutingResource["runnerFlag"] = null;

        if (job?.runner_id === null || job?.runner_id === undefined) {
          skipped.push("The attempt was not run on a farm runner, so no runner was flagged.");
        } else {
          const note =
            request.note ??
            `Classified infra_rig: ${row.name} failed in build ${attempt.attempt_seq} on this runner.`;
          const notedAt = await this.triage.flagRunner(
            organizationId,
            job.runner_id,
            note,
            requester.id,
          );

          if (notedAt === undefined) {
            skipped.push("The runner that ran the attempt has been removed.");
          } else {
            runnerFlag = {
              runnerId: job.runner_id,
              runnerName: job.runner_name,
              note,
              notedAt: notedAt.toISOString(),
            };
            await this.audit.record({
              organizationId,
              actorId: requester.id,
              action: RUNNER_FLAGGED_EVENT,
              subjectType: "runner",
              subjectId: job.runner_id,
              at: notedAt,
              detail: {
                name: job.runner_name,
                classification_id: classificationId,
                test_run_id: attempt.id,
              },
            });
          }
        }

        if (request.toggles?.requeue !== true) return { ...base, runnerFlag, skipped };

        const cases = await this.triage.cases(organizationId, attempt.id);
        const requeued = await this.tryDispatch(
          organizationId,
          requester.id,
          attempt,
          "full",
          cases,
        );

        return {
          ...base,
          runnerFlag,
          rerun: requeued.rerun,
          skipped: [...skipped, ...requeued.skipped],
        };
      }
    }
  }

  /**
   * {@link dispatch}, with a refusal turned into a `skipped` sentence — for a route, where the
   * classification has already been recorded and the dispatch is its consequence.
   *
   * @param organizationId - The workspace.
   * @param actorId - Who asked.
   * @param attempt - The attempt.
   * @param scope - The selection's scope.
   * @param cases - The cases to run.
   * @returns The re-run, or null and why.
   */
  private async tryDispatch(
    organizationId: string,
    actorId: string,
    attempt: AttemptRow,
    scope: TestSelectionScope,
    cases: readonly CaseRow[],
  ): Promise<{ rerun: RerunResource | null; skipped: string[] }> {
    try {
      return {
        rerun: await this.dispatch(organizationId, actorId, attempt, scope, cases),
        skipped: [],
      };
    } catch (error) {
      if (error instanceof DomainError) return { rerun: null, skipped: [error.message] };
      throw error;
    }
  }

  /**
   * Dispatch a re-run of some cases of an attempt through AH.4, as a new build.
   *
   * @param organizationId - The workspace.
   * @param actorId - Who asked.
   * @param attempt - The attempt.
   * @param scope - `failed` or `full`.
   * @param cases - The cases; their distinct keys are the selection.
   * @returns The re-run.
   * @throws {ConflictError} `409 rerun_nothing_selected`, `409 rerun_source_missing`, and the
   *   farm's refusals.
   */
  private async dispatch(
    organizationId: string,
    actorId: string,
    attempt: AttemptRow,
    scope: TestSelectionScope,
    cases: readonly CaseRow[],
  ): Promise<RerunResource> {
    const caseKeys = [...new Set(cases.map((row) => row.case_key))];

    if (caseKeys.length === 0) throw rerunNothingSelected(attempt.id, scope);

    const source = await this.triage.rerunSource(organizationId, attempt);

    if (source === undefined) throw rerunSourceMissing(attempt.id);

    const title =
      scope === "failed"
        ? `Re-run failed (${caseKeys.length})`
        : `Re-run full suite (${caseKeys.length})`;
    const { job, queueState } = await this.jobs.submitRerun(
      organizationId,
      actorId,
      attempt.run_id,
      source,
      { scope, test_run_id: attempt.id, case_keys: caseKeys },
      title,
    );

    return { testRunId: attempt.id, scope, caseKeys, job, queueState };
  }

  /**
   * An attempt of this workspace, or `404`.
   *
   * @param organizationId - The workspace.
   * @param testRunId - The attempt.
   * @returns It.
   * @throws {NotFoundError} `404 test_run_not_found`.
   */
  private async attemptOrThrow(organizationId: string, testRunId: string): Promise<AttemptRow> {
    const attempt = await this.triage.attempt(organizationId, testRunId);

    if (attempt === undefined) throw testRunNotFound(testRunId);

    return attempt;
  }
}

/**
 * The receipt a routing earns — only what was actually dispatched (V055), or null when nothing
 * was: a rejected correction round keeps its control id, which names the refusal, but opens no
 * attempt.
 *
 * @param routing - What routing did.
 * @returns The receipt, or null.
 */
export function receiptOf(routing: RoutingResource): ClassificationReceipt | null {
  const receipt: ClassificationReceipt = {
    ...(routing.control === null ? {} : { control_id: routing.control.id }),
    ...(routing.targetAttempt === null ? {} : { target_attempt: routing.targetAttempt }),
    ...(routing.rerun === null ? {} : { rerun_job_id: routing.rerun.job.id }),
  };

  return Object.keys(receipt).length === 0 ? null : { ...receipt, route: routing.route };
}

/**
 * A receipt as flat audit scalars.
 *
 * @param receipt - The receipt.
 * @returns Its dispatch keys.
 */
function flatReceipt(receipt: ClassificationReceipt): Record<string, string | number> {
  return {
    ...(typeof receipt.control_id === "string" ? { control_id: receipt.control_id } : {}),
    ...(typeof receipt.rerun_job_id === "string" ? { rerun_job_id: receipt.rerun_job_id } : {}),
    ...(typeof receipt.target_attempt === "number"
      ? { target_attempt: receipt.target_attempt }
      : {}),
  };
}
