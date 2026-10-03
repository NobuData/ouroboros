/**
 * The Build Analyzer's suggestion actions — preview, apply, dismiss, draft and push (BV.5,
 * [#514](https://github.com/NobuData/ouroboros/issues/514), decisions A4/A5, mockup 18's *Apply ·
 * Details · Dismiss*, *Draft spike ticket*, *Draft as v16 →* and *Push 4 tickets to backlog →*).
 *
 * **The analyzer never mutates another plane.** Every apply is a composition: `bindings.ts` turns
 * the suggestion's binding into the payload the owning plane takes, and this service hands it to
 * that plane's own service —
 *
 * ```
 * farm_config ─▶ PoolWindowsService.add       (farm: runner_pool_windows)
 * job_hook    ─▶ JobHooksService.register     (farm: farm_job_hooks)
 * workflow    ─▶ WorkflowsService.proposeDraft (a WF-P.3 draft; publishing stays human)
 * test_gate   ─▶ refused: no plane owns per-stage gates yet
 * planning    ─▶ drafted: BatchesService.compose (an AK batch, analyzer-v1) ─▶ PushService.push
 * ```
 *
 * — and writes only its own tables (`actions.repository.ts`). `actions.boundary.spec.ts` holds it
 * to that.
 *
 * **An apply, in order.** Everything that can refuse refuses before any plane is touched: the
 * suggestion is open, the plan is appliable and is the one the caller previewed (`fingerprint`),
 * the impact has a prediction to freeze, and the target metric has a baseline. Then the plane
 * changes, the apply is audited (`analysis_suggestion.applied`, the event V081 requires), and one
 * transaction moves the suggestion to `applied`, keeps the application record with its reversal,
 * and writes BU.3's measurement row — baseline, target metric and prediction, frozen now.
 *
 * A failure after the plane accepted the change leaves the change in place and the suggestion
 * open; the farm writes are idempotent, so applying again records it without a second window or
 * hook. A workflow proposal is guarded by the draft's etag, so a second one after a partial apply
 * is a `409` on a fresh preview rather than a duplicate draft.
 */

import { Injectable } from "@nestjs/common";

import {
  ANALYSIS_SUGGESTION_APPLIED_EVENT,
  ANALYSIS_SUGGESTION_DISMISSED_EVENT,
  ANALYSIS_SUGGESTION_DRAFTED_EVENT,
  ANALYZER_BATCH_PUSHED_EVENT,
} from "../../audit/audit.events";
import { AuditService } from "../../audit/audit.service";
import { NotFoundError } from "../../errors/error.envelope";
import { JobHooksService } from "../../farm/config/job-hooks.service";
import { PoolWindowsService } from "../../farm/config/pool-windows.service";
import { BatchesService } from "../../planning/batches.service";
import type { BatchResource } from "../../planning/planning.resources";
import { PushService, type PushReport } from "../../planning/push.service";
import { validateWorkflowDocument } from "../../workflows/dsl.validator";
import { WorkflowsService } from "../../workflows/workflows.service";
import { CorpusRepository } from "../corpus/corpus.repository";
import {
  baselineUnavailable,
  batchNotFound,
  notDraftable,
  planeUnavailable,
  previewStale,
  suggestionNotFound,
  suggestionResolved,
} from "./actions.errors";
import { ActionsRepository, type SuggestionRow } from "./actions.repository";
import {
  previewResource,
  studioPath,
  type AppliedSuggestionResource,
  type SuggestionPreviewResource,
  type SuggestionResolutionResource,
} from "./actions.resources";
import {
  planFingerprint,
  planOf,
  workflowPlan,
  type ActionPlan,
  type PlanSubject,
} from "./bindings";
import {
  windowValue,
  baselineWindow,
  MEASUREMENT_TARGETS,
  predictedOf,
  type MetricPoint,
} from "./measurement";
import { ticketDraftOf } from "./ticket.drafts";

/** The planner name an analyzer-drafted batch carries (V034's `analyzer-vN` family). */
export const ANALYZER_PLANNER = "analyzer-v1";

/** What a dismissal without a reason records — V081 requires one. */
export const NO_REASON = "Dismissed without a reason.";

/** Where an applied change landed, and the call that would undo it. */
interface Landing {
  target: { kind: string; id: string } & Record<string, unknown>;
  reversal: { action: string; target: Record<string, unknown> };
}

/** A drafted batch, and the suggestions drafted into it. */
export interface DraftedBatch {
  batch: BatchResource;
  suggestionIds: string[];
}

@Injectable()
export class SuggestionActionsService {
  /**
   * @param suggestions - The analyzer's own statements.
   * @param corpus - The rollup grain, for the baseline.
   * @param windows - The farm's time-windowed pool assignment.
   * @param hooks - The farm's job hooks.
   * @param workflows - WF-P.3's drafts.
   * @param batches - AK's draft batches.
   * @param pusher - AL.3's push.
   * @param audit - AD.4's trail.
   */
  constructor(
    private readonly suggestions: ActionsRepository,
    private readonly corpus: CorpusRepository,
    private readonly windows: PoolWindowsService,
    private readonly hooks: JobHooksService,
    private readonly workflows: WorkflowsService,
    private readonly batches: BatchesService,
    private readonly pusher: PushService,
    private readonly audit: AuditService,
  ) {}

  /**
   * The consequence preview — what Apply would change and where. **No side effects**: it reads the
   * suggestion and, for a workflow, the base document, and writes nothing.
   *
   * @param organizationId - The workspace.
   * @param id - The suggestion.
   * @returns The preview.
   * @throws {NotFoundError} `analysis_suggestion_not_found`, or the workflow's `workflow_not_found`.
   */
  async preview(organizationId: string, id: string): Promise<SuggestionPreviewResource> {
    const suggestion = await this.require(organizationId, id);
    return previewResource(id, await this.plan(organizationId, suggestion), draftable(suggestion));
  }

  /**
   * Apply a suggestion through the plane that owns its change. See the file header for the order.
   *
   * @param organizationId - The workspace.
   * @param actorId - The administrator applying it.
   * @param id - The suggestion.
   * @param fingerprint - The preview's fingerprint, when the caller insists on it.
   * @returns What was applied, where it landed, the audit event and the measurement row.
   * @throws {NotFoundError} `analysis_suggestion_not_found`.
   * @throws {ConflictError} `analysis_suggestion_resolved`, `analysis_preview_stale`,
   *   `analysis_baseline_unavailable`, or the plane's own conflict (`workflow_draft_conflict`).
   * @throws {InvalidRequestError} `analysis_plane_unavailable`.
   */
  async apply(
    organizationId: string,
    actorId: string,
    id: string,
    fingerprint?: string,
  ): Promise<AppliedSuggestionResource> {
    const suggestion = await this.require(organizationId, id);
    if (suggestion.status !== "open") throw suggestionResolved(suggestion.status);

    const plan = await this.plan(organizationId, suggestion);
    if (plan.kind === "unavailable") throw planeUnavailable(plan.plane, plan.reason);

    const current = planFingerprint(plan);
    if (fingerprint !== undefined && fingerprint !== current) {
      throw previewStale(fingerprint, current);
    }

    const appliedAt = new Date();
    const measurement = await this.measurementOf(organizationId, suggestion, plan, appliedAt);
    const landing = await this.execute(organizationId, actorId, plan);
    const preview = previewResource(id, plan, false);

    const eventId = await this.audit.record({
      organizationId,
      actorId,
      action: ANALYSIS_SUGGESTION_APPLIED_EVENT,
      subjectType: "analysis_suggestion",
      subjectId: id,
      at: appliedAt,
      detail: {
        repo: suggestion.repo_ref,
        plane: plan.plane,
        preview: plan.summary,
        change: JSON.stringify(
          plan.kind === "workflow_draft" ? workflowSummary(plan) : plan.change,
        ),
        target_kind: landing.target.kind,
        target_id: landing.target.id,
      },
    });

    const row = await this.suggestions.recordApply({
      organizationId,
      suggestionId: id,
      repoRef: suggestion.repo_ref,
      actorId,
      appliedAt,
      eventId,
      plane: plan.plane,
      change: plan.kind === "workflow_draft" ? workflowSummary(plan) : plan.change,
      preview: plan.summary,
      target: landing.target,
      reversal: landing.reversal,
      measurement,
    });
    if (row === undefined) throw suggestionResolved("resolved");

    return {
      suggestion: { id, status: "applied", resolvedAt: appliedAt.toISOString(), reason: null },
      preview,
      target: landing.target,
      eventId,
      measurement: {
        id: row.id,
        targetMetric: row.target_metric,
        windowDays: row.window_days,
        baseline: row.baseline,
        predicted: row.predicted,
      },
    };
  }

  /**
   * Dismiss a suggestion. Member-level, and remembered against the suggestion's stable identity:
   * re-analysis updates the row and keeps it dismissed.
   *
   * @param organizationId - The workspace.
   * @param actorId - Who dismissed it.
   * @param id - The suggestion.
   * @param reason - Why; optional.
   * @returns The resolution.
   * @throws {NotFoundError} `analysis_suggestion_not_found`.
   * @throws {ConflictError} `analysis_suggestion_resolved`.
   */
  async dismiss(
    organizationId: string,
    actorId: string,
    id: string,
    reason?: string,
  ): Promise<SuggestionResolutionResource> {
    const suggestion = await this.require(organizationId, id);
    if (suggestion.status !== "open") throw suggestionResolved(suggestion.status);

    const at = new Date();
    const recorded = reason?.trim() ?? NO_REASON;
    if (!(await this.suggestions.dismiss(organizationId, id, actorId, recorded, at))) {
      throw suggestionResolved("resolved");
    }

    await this.audit.record({
      organizationId,
      actorId,
      action: ANALYSIS_SUGGESTION_DISMISSED_EVENT,
      subjectType: "analysis_suggestion",
      subjectId: id,
      at,
      detail: { repo: suggestion.repo_ref, title: suggestion.title, reason: recorded },
    });

    return { id, status: "dismissed", resolvedAt: at.toISOString(), reason: recorded };
  }

  /**
   * Draft ticket and spike suggestions into one AK batch (`analyzer-v1`), sized by the estimator,
   * ready for the standard edit and push flow.
   *
   * @param organizationId - The workspace.
   * @param actorId - The administrator drafting them.
   * @param ids - The suggestions, in batch order.
   * @param targetSourceId - The write-capable ticket source.
   * @returns The batch and the suggestions drafted into it.
   * @throws {NotFoundError} `analysis_suggestion_not_found`, `planning_source_not_found`.
   * @throws {ConflictError} `analysis_suggestion_resolved`, `planning_target_read_only`.
   * @throws {InvalidRequestError} `analysis_suggestion_not_draftable`.
   */
  async draft(
    organizationId: string,
    actorId: string,
    ids: readonly string[],
    targetSourceId: string,
  ): Promise<DraftedBatch> {
    const rows: SuggestionRow[] = [];
    for (const id of ids) {
      const suggestion = await this.require(organizationId, id);
      if (suggestion.status !== "open") throw suggestionResolved(suggestion.status);
      if (!draftable(suggestion)) throw notDraftable(id);
      rows.push(suggestion);
    }

    const repos = [...new Set(rows.map((row) => row.repo_ref))].join(", ");
    const batch = await this.batches.compose(organizationId, actorId, {
      prompt: `Build Analyzer: ${String(rows.length)} ticket(s) drafted from the patterns in ${repos}`,
      planner: ANALYZER_PLANNER,
      targetSourceId,
      drafts: rows.map((row, index) => ticketDraftOf(row, index + 1)),
    });

    const at = new Date();
    // In the order asked for — `update … returning` promises none.
    const moved = new Set(
      await this.suggestions.markDrafted(organizationId, ids, batch.id, actorId, at),
    );
    const drafted = ids.filter((id) => moved.has(id));
    for (const id of drafted) {
      await this.audit.record({
        organizationId,
        actorId,
        action: ANALYSIS_SUGGESTION_DRAFTED_EVENT,
        subjectType: "analysis_suggestion",
        subjectId: id,
        at,
        detail: { batch_id: batch.id, planner: ANALYZER_PLANNER },
      });
    }

    return { batch, suggestionIds: drafted };
  }

  /**
   * Push an analyzer-drafted batch's selected drafts to its tracker — AL.3's push, idempotent:
   * a draft already pushed is not pushed again, and the SPI's idempotency key makes a retried
   * create one ticket.
   *
   * @param organizationId - The workspace.
   * @param actorId - The administrator pushing it.
   * @param batchId - The batch.
   * @returns The push report.
   * @throws {NotFoundError} `analysis_batch_not_found` for a batch the analyzer did not draft.
   */
  async push(organizationId: string, actorId: string, batchId: string): Promise<PushReport> {
    let batch: BatchResource;
    try {
      batch = await this.batches.read(organizationId, batchId);
    } catch (error) {
      if (error instanceof NotFoundError) throw batchNotFound(batchId);
      throw error;
    }
    if (!batch.planner.startsWith("analyzer-v")) throw batchNotFound(batchId);

    const report = await this.pusher.push(organizationId, batchId);

    await this.audit.record({
      organizationId,
      actorId,
      action: ANALYZER_BATCH_PUSHED_EVENT,
      subjectType: "draft_batch",
      subjectId: batchId,
      at: new Date(),
      detail: {
        outcome: report.outcome,
        batch_status: report.batchStatus,
        pushed_this_run: report.pushedThisRun,
      },
    });

    return report;
  }

  /**
   * A suggestion of the workspace, or the `404`.
   *
   * @param organizationId - The workspace.
   * @param id - The suggestion.
   * @returns The row.
   */
  private async require(organizationId: string, id: string): Promise<SuggestionRow> {
    const suggestion = await this.suggestions.suggestion(organizationId, id);
    if (suggestion === undefined) throw suggestionNotFound();
    return suggestion;
  }

  /**
   * The plan for a suggestion — reading the workflow's base document when the binding needs one.
   *
   * @param organizationId - The workspace.
   * @param suggestion - The suggestion.
   * @returns The plan.
   */
  private async plan(organizationId: string, suggestion: SuggestionRow): Promise<ActionPlan> {
    const subject: PlanSubject = {
      id: suggestion.id,
      repoRef: suggestion.repo_ref,
      title: suggestion.title,
      evidenceLine: suggestion.evidence_line,
      needsSpike: suggestion.needs_spike,
      kind: suggestion.kind,
      binding: suggestion.action_binding,
    };
    const plan = planOf(subject);
    if (plan !== undefined) return plan;

    const slug = suggestion.action_binding.change.workflow;
    if (typeof slug !== "string" || slug === "") {
      return {
        kind: "unavailable",
        plane: "workflow",
        summary: suggestion.title,
        lands: "nowhere — not applied",
        reason: "the binding names no workflow",
      };
    }
    const base = await this.workflows.draftBase(organizationId, slug);
    return workflowPlan(subject, base, validateWorkflowDocument(base.definition).document);
  }

  /**
   * The measurement row's content — refused before any plane is touched when there is nothing to
   * freeze or nothing to measure against.
   *
   * @param organizationId - The workspace.
   * @param suggestion - The suggestion.
   * @param plan - Its appliable plan.
   * @param appliedAt - The apply instant.
   * @returns The target metric, baseline and prediction.
   */
  private async measurementOf(
    organizationId: string,
    suggestion: SuggestionRow,
    plan: ActionPlan,
    appliedAt: Date,
  ): Promise<{ targetMetric: string; baseline: unknown; predicted: unknown }> {
    const impact = suggestion.impact;
    const predicted = impact === null ? undefined : predictedOf(impact);
    const target =
      impact === null ? undefined : MEASUREMENT_TARGETS[impact.basis.calibration.impact_class];
    if (impact === null || predicted === undefined || target === undefined) {
      throw planeUnavailable(
        plan.plane,
        "its impact carries no prediction this apply could measure",
      );
    }

    const days = await this.suggestions.windowDays(organizationId);
    const window = baselineWindow(appliedAt, days);
    const dimension =
      target.metric === "queue_wait" && plan.kind === "pool_window" ? plan.change.pool : null;
    const points: MetricPoint[] = (
      await this.corpus.series(
        { organizationId, repoRef: suggestion.repo_ref },
        window,
        target.metric,
      )
    ).filter((point) => dimension === null || point.dimension === dimension);
    const value = windowValue(target, points, days);
    if (value === undefined) throw baselineUnavailable(target.metric, window.from, window.to);

    return {
      targetMetric: target.metric,
      baseline: {
        window,
        value,
        statistic: target.statistic,
        ...(dimension === null ? {} : { dimension }),
      },
      predicted,
    };
  }

  /**
   * Hand the plan to its plane.
   *
   * @param organizationId - The workspace.
   * @param actorId - Who is applying it.
   * @param plan - An appliable plan.
   * @returns Where it landed and how it would be undone.
   */
  private async execute(
    organizationId: string,
    actorId: string,
    plan: Exclude<ActionPlan, { kind: "unavailable" }>,
  ): Promise<Landing> {
    switch (plan.kind) {
      case "pool_window": {
        const { window } = await this.windows.add(organizationId, actorId, plan.change);
        return {
          target: {
            kind: "runner_pool_window",
            id: window.id,
            runner: window.runner.name,
            pool: window.pool.name,
          },
          reversal: { action: "farm.pool_window.delete", target: { id: window.id } },
        };
      }
      case "job_hook": {
        const { titleContains, ...rest } = plan.change;
        const { hook } = await this.hooks.register(organizationId, actorId, {
          ...rest,
          ...(titleContains === null ? {} : { titleContains }),
        });
        return {
          target: { kind: "farm_job_hook", id: hook.id, repo: hook.repo, pool: hook.pool.name },
          reversal: { action: "farm.job_hook.delete", target: { id: hook.id } },
        };
      }
      case "workflow_draft": {
        const { change } = plan;
        const draft = await this.workflows.proposeDraft(
          organizationId,
          change.workflowId,
          change.ifMatch,
          change.definition,
          change.changeNote,
        );
        return {
          target: {
            kind: "workflow_draft",
            id: change.workflowId,
            slug: change.slug,
            etag: draft.etag,
            nextVersion: change.nextVersion,
            studioPath: studioPath(change.slug),
          },
          // Undoing a proposal is restoring the base it was drafted on — its etag says which.
          reversal: {
            action: "workflow.draft.restore",
            target: { workflowId: change.workflowId, baseEtag: change.ifMatch, etag: draft.etag },
          },
        };
      }
    }
  }
}

/**
 * Whether a suggestion is drafted as a ticket rather than applied.
 *
 * @param suggestion - The suggestion.
 * @returns True for a ticket draft or a spike.
 */
function draftable(suggestion: SuggestionRow): boolean {
  return suggestion.kind === "ticket_draft" || suggestion.needs_spike;
}

/**
 * A workflow plan's payload without its whole document — what the trail and the application
 * record keep; the document itself is the draft.
 *
 * @param plan - A workflow plan.
 * @returns The workflow, base etag, version and note.
 */
function workflowSummary(
  plan: Extract<ActionPlan, { kind: "workflow_draft" }>,
): Record<string, unknown> {
  const { definition: _definition, ...rest } = plan.change;
  return rest;
}
