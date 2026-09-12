/**
 * The rules of `POST /api/v1/backlog/queue`
 * (M.3, [#112](https://github.com/NobuData/ouroboros/issues/112)), which are four:
 *
 *   * **Everything is checked before anything is written, and the write is all-or-nothing.**
 *     The three refusals below happen against one read of the selection, and the insert that
 *     follows is one transaction. A person who pressed *Queue 3 selected* is never left
 *     guessing which of the three took — which is the trade the ticket made on purpose and
 *     states in the OpenAPI description.
 *
 *   * **The refusals are ordered, and the order is what a client can act on.** Ids this
 *     workspace cannot see are a `404` first, because an issue you may not know about has no
 *     state worth reporting; then the issues that are not `sized`, a `422`; then the ones the
 *     queue already holds, a `409`. One request is refused for one reason at a time, with every
 *     offender of *that* reason named — a body that mixed the three would ask a client to
 *     render three failures for one press.
 *
 *   * **A queue row is copied from the estimate in force, never recomputed.** The effort chip,
 *     the workflow tag when the request names none, and `est_minutes` all come off the same
 *     latest-wins row — `est_minutes` from `breakdown.est_minutes`, which is the ticket's own
 *     criterion. `queue.resources.ts` holds the two reconciliations that copy needs.
 *
 *   * **An explicit `workflow` wins; otherwise each issue keeps its own.** *Queue →
 *     standard-fix* sends one tag for the selection and *Queue 3 selected* sends none, in which
 *     case each row is queued under the workflow its own estimate suggested. That is the whole
 *     of the rule today; the amendment on the ticket records that #143's trigger evaluation
 *     will fill the default by predicate instead, with an explicit choice still winning.
 *
 * ---------------------------------------------------------------------------
 * **A named workflow is checked against the workspace's registry, and P.4 is why**
 * ([#135](https://github.com/NobuData/ouroboros/issues/135), absorbing
 * [#124](https://github.com/NobuData/ouroboros/issues/124)).
 *
 * The tag used to be held to decision **K5**'s four by an `@IsIn` on the body, which needed no
 * query because the vocabulary was a constant every installation shared. It is now this
 * workspace's own active workflows — the same list *Assign workflow ▾* is drawn from — so the
 * check is a read, and it is **first**, before the selection is even looked up: a request that
 * names a workflow the workspace does not have cannot succeed for any selection, and refusing
 * it before touching `github_issues` keeps one failure one answer.
 *
 * **Only an explicit tag is checked.** A row queued under *each issue's own* copies
 * `suggested_workflow` off the estimate in force, and that value was already held to the
 * offered vocabulary — by the engine, at the moment the estimate was made, against the same
 * registry (`estimation/estimation.context.ts`). Re-checking it here would refuse a stored
 * estimate for naming a workflow that has since been renamed, which is exactly the history
 * decision **F8** keeps readable: the queue row is opaque text, and a tag that no longer
 * resolves is a fact about the past rather than a broken write.
 */

import { Injectable } from "@nestjs/common";

import { WorkflowRegistryService } from "../workflows/registry.service";
import {
  QUEUE_ISSUE_PROBLEMS,
  queueIssuesConflict,
  queueIssuesNotFound,
  queueIssuesNotQueueable,
  queueWorkflowUnknown,
  type QueueIssueProblem,
} from "./queue.errors";
import {
  queueEffort,
  queueEstMinutes,
  queuedSelection,
  type QueuedSelection,
} from "./queue.resources";
import {
  BacklogQueueRepository,
  isQueuedTwice,
  type QueueAppendRow,
  type QueueCandidate,
} from "./queue.repository";
import type { QueueSelectionBody } from "./queue.dto";

/** A candidate that passed every check — the four nullable fields narrowed by having done so. */
interface QueueableIssue extends QueueCandidate {
  readonly effort: NonNullable<QueueCandidate["effort"]>;
  readonly suggestedWorkflow: NonNullable<QueueCandidate["suggestedWorkflow"]>;
  readonly estMinutes: NonNullable<QueueCandidate["estMinutes"]>;
}

@Injectable()
export class BacklogQueueService {
  /**
   * @param queue - The two reads and the write.
   * @param workflows - P.4's registry, for the one check that is not about the issues. The same
   *   service `estimation.context.ts` offers the engine, so what a menu lists, what an estimate
   *   may suggest and what this accepts are one answer.
   */
  constructor(
    private readonly queue: BacklogQueueRepository,
    private readonly workflows: WorkflowRegistryService,
  ) {}

  /**
   * Queue a selection of issues, or refuse the whole of it.
   *
   * @param organizationId - The workspace, established by the tenant guard. Every statement is
   *   scoped by it, so an id belonging to another workspace is simply not found.
   * @param body - The issues, in the order to append them, and the workflow they all run under
   *   when one is named.
   * @returns The created queue items in queue order, and their combined estimate — the number
   *   the selection action bar renders as *"est. 1h 10m combined autonomous work"*.
   * @throws {NotFoundError} `queue_issues_not_found` — an id names no issue in this workspace,
   *   including one that names an issue in another.
   * @throws {InvalidRequestError} `queue_workflow_unknown` — the request named a workflow this
   *   workspace does not have. Checked before the selection, for the reason this file's header
   *   gives.
   * @throws {InvalidRequestError} `queue_issues_not_queueable` — an issue in the selection is
   *   not `sized`, or is `sized` with no estimate to copy.
   * @throws {ConflictError} `queue_issues_conflict` — the queue already holds one of them, or
   *   two of them share a GitHub number.
   */
  async queueSelection(organizationId: string, body: QueueSelectionBody): Promise<QueuedSelection> {
    await this.refuseUnknownWorkflow(organizationId, body.workflow);

    const found = await this.queue.selection(organizationId, body.issueIds);
    // Reordered into the request's own order: positions are handed out down this list, so the
    // queue reads the way the person built the selection rather than the way a planner
    // happened to return the rows.
    const candidates = ordered(body.issueIds, found);

    this.refuseUnknown(body.issueIds, candidates);
    const queueable = this.refuseUnsized(candidates);

    const conflicts = await this.conflicts(organizationId, queueable);
    if (conflicts.length > 0) {
      throw queueIssuesConflict(conflicts);
    }

    const rows = queueable.map((issue) => appendRow(issue, body.workflow));

    try {
      return queuedSelection(await this.queue.append(organizationId, rows));
    } catch (error) {
      // The window between the check above and the insert, closed by
      // `queue_items_organization_issue_key`. Anything else is the service's own failure and
      // stays the `500` it is.
      if (!isQueuedTwice(error)) {
        throw error;
      }

      // Asked again so the answer is still per-issue: the winner of the race is in the queue
      // now, and naming it is what N.4 renders. `details.issues` is empty only if that row was
      // also removed while this request was failing over it — three writers in one instant, and
      // an empty list is more honest than a guess about which of them collided.
      throw queueIssuesConflict(await this.conflicts(organizationId, queueable));
    }
  }

  /**
   * `422` when the request named a workflow this workspace does not have.
   *
   * @param organizationId - The workspace, established by the tenant guard.
   * @param workflow - What the request named, or `undefined` for *each issue's own* — which
   *   names no workflow and therefore has none to check.
   * @throws {InvalidRequestError} `queue_workflow_unknown`, carrying the slug and the
   *   vocabulary it was held to, so a stale menu can redraw itself from the refusal.
   */
  private async refuseUnknownWorkflow(
    organizationId: string,
    workflow: string | undefined,
  ): Promise<void> {
    if (workflow === undefined) {
      return;
    }

    const { slugs } = await this.workflows.offered(organizationId);

    if (!slugs.includes(workflow)) {
      throw queueWorkflowUnknown(workflow, slugs);
    }
  }

  /**
   * `404` when any id named nothing this workspace can see.
   *
   * @param issueIds - What the request asked for.
   * @param candidates - What the workspace actually holds, already in request order.
   * @throws {NotFoundError} `queue_issues_not_found`, naming every id that matched nothing.
   */
  private refuseUnknown(issueIds: readonly string[], candidates: readonly QueueCandidate[]): void {
    if (candidates.length === issueIds.length) {
      return;
    }

    const known = new Set(candidates.map((candidate) => candidate.id));
    const missing = issueIds.filter((id) => !known.has(id));

    throw queueIssuesNotFound(
      missing.map((issueId) => ({ issueId, code: QUEUE_ISSUE_PROBLEMS.notFound })),
    );
  }

  /**
   * `422` unless every issue is `sized` and carries the estimate that says so.
   *
   * The two problems are reported apart because they are different facts: `issue_not_sized` is
   * the ordinary one a person can wait out or act on, and `issue_estimate_missing` is a `sized`
   * issue whose estimate has been deleted — see `queue.errors.ts` on why that is answerable
   * rather than a `500`.
   *
   * @param candidates - Every named issue, in request order.
   * @returns The same issues, narrowed: an effort, a suggested workflow and an estimate that
   *   are no longer nullable, because a candidate that returns from here has all three.
   * @throws {InvalidRequestError} `queue_issues_not_queueable`, naming every offender.
   */
  private refuseUnsized(candidates: readonly QueueCandidate[]): QueueableIssue[] {
    const problems: QueueIssueProblem[] = [];
    const queueable: QueueableIssue[] = [];

    for (const candidate of candidates) {
      if (candidate.sizingStatus !== "sized") {
        problems.push({
          issueId: candidate.id,
          code: QUEUE_ISSUE_PROBLEMS.notSized,
          issueNumber: candidate.number,
          sizingStatus: candidate.sizingStatus,
        });
      } else if (
        candidate.effort === null ||
        candidate.suggestedWorkflow === null ||
        candidate.estMinutes === null
      ) {
        // All three are null together — the lateral either matched a row or it did not, and
        // V026 makes every column behind them `not null` — so testing the three is what lets
        // the narrowing below be a narrowing rather than a cast.
        problems.push({
          issueId: candidate.id,
          code: QUEUE_ISSUE_PROBLEMS.estimateMissing,
          issueNumber: candidate.number,
        });
      } else {
        // Rebuilt from the narrowed values rather than cast: the three checks above are what
        // make this a `QueueableIssue`, and a cast would let one of them be deleted without
        // the compiler noticing.
        queueable.push({
          ...candidate,
          effort: candidate.effort,
          suggestedWorkflow: candidate.suggestedWorkflow,
          estMinutes: candidate.estMinutes,
        });
      }
    }

    if (problems.length > 0) {
      throw queueIssuesNotQueueable(problems);
    }

    return queueable;
  }

  /**
   * Which of these issues the queue already speaks for.
   *
   * Two ways it can, and both are `queue_items_organization_issue_key`: a row the queue already
   * holds, and two issues *in this selection* carrying one number — which a workspace watching
   * two repositories can genuinely produce, since that key is `(organization_id, issue_number)`
   * and deliberately over-reaches across repositories (V009 argues why).
   *
   * Returns rather than throws, because it is asked twice: once before the write, and once
   * after the constraint refuses one this read had said was free.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param queueable - The issues that would be written, in request order.
   * @returns One problem per offender, in that order. Empty when the queue holds none of them.
   */
  private async conflicts(
    organizationId: string,
    queueable: readonly QueueableIssue[],
  ): Promise<QueueIssueProblem[]> {
    const numbers = queueable.map((issue) => issue.number);
    const taken = new Set(await this.queue.queuedNumbers(organizationId, numbers));

    const problems: QueueIssueProblem[] = [];
    const seen = new Set<number>();

    for (const issue of queueable) {
      const code = taken.has(issue.number)
        ? QUEUE_ISSUE_PROBLEMS.alreadyQueued
        : seen.has(issue.number)
          ? QUEUE_ISSUE_PROBLEMS.numberTaken
          : undefined;

      seen.add(issue.number);

      if (code !== undefined) {
        problems.push({ issueId: issue.id, code, issueNumber: issue.number });
      }
    }

    return problems;
  }
}

/**
 * The rows the statement returned, in the order the request listed them.
 *
 * @param issueIds - The request's own order.
 * @param found - What the workspace holds, in whatever order the planner returned it.
 * @returns One entry per id that matched, request order preserved. Ids that matched nothing are
 *   absent rather than held as gaps — {@link BacklogQueueService.refuseUnknown} is what names
 *   them, from the difference in length.
 */
function ordered(issueIds: readonly string[], found: readonly QueueCandidate[]): QueueCandidate[] {
  const byId = new Map(found.map((candidate) => [candidate.id, candidate]));

  return issueIds
    .map((id) => byId.get(id))
    .filter((candidate): candidate is QueueCandidate => candidate !== undefined);
}

/**
 * One queue row, from one sized issue.
 *
 * @param issue - The issue and the estimate in force.
 * @param workflow - The tag the request named, or `undefined` for the issue's own suggestion.
 * @returns The row to append. Every value is copied — see `queue.resources.ts` for the two
 *   places a copy has to reconcile two migrations' bounds.
 */
function appendRow(issue: QueueableIssue, workflow: string | undefined): QueueAppendRow {
  return {
    githubRepoId: issue.githubRepoId,
    issueNumber: issue.number,
    issueTitle: issue.title,
    effort: queueEffort(issue.effort),
    workflowTag: workflow ?? issue.suggestedWorkflow,
    estMinutes: queueEstMinutes(issue.estMinutes),
  };
}
