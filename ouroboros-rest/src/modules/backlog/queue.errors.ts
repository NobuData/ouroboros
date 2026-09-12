/**
 * Every way `POST /api/v1/backlog/queue` refuses, and the per-issue detail each refusal carries
 * (M.3, [#112](https://github.com/NobuData/ouroboros/issues/112)).
 *
 * Codes live beside the operation that produces them rather than in a service-wide registry —
 * `estimation.errors.ts`' rule — and `openapi.yaml` is where the two are published together.
 * `queue.errors.spec.ts` holds this file to it in both directions.
 *
 * ---------------------------------------------------------------------------
 * **The refusals are bulk-shaped, and that is the whole design.**
 *
 * The ticket's criterion is *"422 with per-issue codes naming the offenders, so N.4
 * ([#118](https://github.com/NobuData/ouroboros/issues/118)) can name them instead of showing a
 * generic failure"*. So every refusal here carries `details.issues`: one
 * {@link QueueIssueProblem} per offending issue, each with the id the caller sent, the code that
 * says what is wrong with *that* issue, and whatever the action bar needs to name it. A single
 * scalar `issueId` — `estimation.errors.ts`' shape, right for a path that names one issue —
 * would force a client to re-derive which of the three it selected was the problem, or to give
 * up and render *"something went wrong"*.
 *
 * **Nothing is written by any of them**, which is the all-or-nothing rule this endpoint chose
 * and states in its OpenAPI description: a partly-applied bulk queue is far worse to reason
 * about than a rejected one — the person pressed *Queue 3 selected* and would be left guessing
 * which of the three took.
 *
 * ---------------------------------------------------------------------------
 * **Three statuses, and the differences are the design.**
 *
 *   * `404 queue_issues_not_found` — one or more ids name no issue in this workspace, *or* name
 *     one in another workspace. Deliberately one answer, and deliberately not `403`: a `403`
 *     would confirm that a guessed id is a real issue somewhere, which is exactly what
 *     cross-tenant probing is looking for. `estimation.errors.ts` and
 *     `provider-connections.errors.ts` make the same call.
 *   * `422 queue_issues_not_queueable` — the ids are yours and the issues are not ready. Nothing
 *     about the request is malformed, and nothing about it will succeed until the backlog
 *     changes, which is `InvalidRequestError`'s own definition.
 *   * `409 queue_issues_conflict` — the issues are ready and the *queue* already speaks for
 *     them. Retrying unchanged gets the same answer until somebody dequeues, which is
 *     `ConflictError`'s.
 *
 * ---------------------------------------------------------------------------
 * **A fourth refusal arrived with P.4** ([#135](https://github.com/NobuData/ouroboros/issues/135)),
 * and it is the one refusal here that is not about the issues.
 *
 * `422 queue_workflow_unknown` — the request named a workflow this workspace does not have.
 * It could not exist while decision **K5**'s four tags were a constant in this service, because
 * the `@IsIn` on the body caught every value outside them before a handler ran. Now the
 * vocabulary is *the workspace's own workflows* (`workflows/registry.service.ts`), which is a
 * fact only a query knows — so the body carries a slug-shaped string and this is what says the
 * workspace has nothing by that name.
 *
 * It is **not** bulk-shaped, and that is the exception that proves the rule above: one request
 * names one workflow, so there is one offender and it is not an issue. `details` carries the
 * vocabulary instead, which is what lets a stale assign menu redraw itself from the refusal
 * rather than guess.
 */

import { ConflictError, InvalidRequestError, NotFoundError } from "../errors/error.envelope";
import type { SizingStatus } from "../db/schema";

/**
 * The codes, as one object.
 *
 * `as const` so each value is its own literal type: a helper below cannot be handed a string
 * that nearly matches, and the specification's copy is checked against these.
 */
export const QUEUE_ERRORS = {
  /** `404` — an id named no issue in this workspace, or none this caller may know about. */
  notFound: "queue_issues_not_found",
  /** `422` — an issue in the selection is not in a state that can be queued. */
  notQueueable: "queue_issues_not_queueable",
  /** `409` — the queue already holds one of these issues. */
  conflict: "queue_issues_conflict",
  /** `422` — the request named a workflow this workspace does not have (#135). */
  workflowUnknown: "queue_workflow_unknown",
} as const;

/** One of {@link QUEUE_ERRORS}' values. */
export type QueueErrorCode = (typeof QUEUE_ERRORS)[keyof typeof QUEUE_ERRORS];

/**
 * The per-issue codes, which are what a client actually branches on.
 *
 * The envelope's `code` says *which refusal*, and these say *what is wrong with this row* —
 * the two are separate because one request can be refused for one reason by several issues at
 * once, and the action bar renders a line per issue.
 */
export const QUEUE_ISSUE_PROBLEMS = {
  /** No such issue in this workspace — including an issue that exists in another one. */
  notFound: "issue_not_found",
  /** The issue has not been sized: `unsized`, `estimating` or `needs_human`. */
  notSized: "issue_not_sized",
  /**
   * The issue says `sized` and carries no estimate to read an effort and an estimate off.
   *
   * L.3 ([#107](https://github.com/NobuData/ouroboros/issues/107)) writes the estimate and the
   * status in one transaction, so this is not a state the pipeline produces — it is what is
   * left when an `issue_estimates` row is deleted out from under a `sized` issue. It is a code
   * rather than a `500` because the request is answerable: those issues cannot be queued, the
   * others in the selection are named alongside, and nothing about the service is broken.
   */
  estimateMissing: "issue_estimate_missing",
  /** The queue already holds this issue. */
  alreadyQueued: "issue_already_queued",
  /**
   * Two issues in this one selection carry the same GitHub number.
   *
   * `queue_items_organization_issue_key` is `(organization_id, issue_number)` — a workspace's
   * queue holds each *number* once, deliberately over-reaching across repositories (V009 argues
   * why, and why widening the key is one migration on the day a workspace is bothered by it).
   * So two repositories' `#485` cannot both be queued, and a selection containing both is
   * refused before either is written rather than half-applied.
   */
  numberTaken: "issue_number_taken",
} as const;

/** One of {@link QUEUE_ISSUE_PROBLEMS}' values. */
export type QueueIssueProblemCode =
  (typeof QUEUE_ISSUE_PROBLEMS)[keyof typeof QUEUE_ISSUE_PROBLEMS];

/**
 * What is wrong with one issue of the selection.
 *
 * `issueId` is always the value the caller sent — their own — so a client holding a selection
 * can match an entry back to the row it drew without a second request. `issueNumber` and
 * `sizingStatus` are present only where they are known and only where they say something: a
 * `404` discloses neither, because an issue this workspace cannot see has no number this
 * request is entitled to learn.
 */
export interface QueueIssueProblem {
  /** `github_issues.id`, exactly as the request carried it. */
  readonly issueId: string;
  /** What is wrong with this one. */
  readonly code: QueueIssueProblemCode;
  /** The `#485` a message renders, where this workspace's own row supplied it. */
  readonly issueNumber?: number;
  /** Where the issue actually is in the sizing pipeline, for `issue_not_sized`. */
  readonly sizingStatus?: SizingStatus;
}

/**
 * `404` — some of these ids name no issue in this workspace.
 *
 * The same answer for an id that names nothing and for one that names an issue in another
 * workspace, which is the ticket's *cross-org ids → 404* criterion.
 *
 * @param issues - One entry per unknown id, in the order the request listed them. Each carries
 *   only the id the caller sent, so nothing is disclosed that they did not already have.
 * @returns The error to throw.
 */
export function queueIssuesNotFound(issues: readonly QueueIssueProblem[]): NotFoundError {
  return new NotFoundError(
    QUEUE_ERRORS.notFound,
    "Some of those issues are not in this workspace.",
    { issues },
  );
}

/**
 * `422` — some of these issues are not ready to be queued.
 *
 * The ticket's *"unsized or in-flight issues → 422 listing the offenders per-issue"*. An issue
 * is queueable exactly when it is `sized` and carries the estimate that says so: the queue row
 * copies an effort, a workflow and an estimate off it, and there is nothing honest to write for
 * an issue nobody has sized. `estimating` is refused rather than waited for — a request that
 * blocked on an engine call is a timeout, and the person can press the button again when the
 * pill changes.
 *
 * @param issues - One entry per offending issue, in the order the request listed them, each
 *   naming its number and the status it is actually in.
 * @returns The error to throw.
 */
export function queueIssuesNotQueueable(issues: readonly QueueIssueProblem[]): InvalidRequestError {
  return new InvalidRequestError(
    QUEUE_ERRORS.notQueueable,
    "Some of those issues have not been sized yet. Only sized issues can be queued.",
    { issues },
  );
}

/**
 * What a `queue_workflow_unknown` refusal carries.
 *
 * Both halves are needed and neither is guessable from the other: the slug says *which* value
 * was refused — a client may have sent one it read from a menu that has since changed — and
 * the vocabulary says what to offer instead, so the next press is a valid one without a second
 * request to find out.
 */
export interface QueueWorkflowProblem {
  /** The slug the request named, exactly as it sent it. */
  readonly workflow: string;
  /** Every workflow this workspace offers, in the order its rail lists them. */
  readonly offered: readonly string[];
}

/**
 * `422` — this workspace has no workflow by that name.
 *
 * A `422` rather than a `404`, for {@link queueIssuesNotQueueable}'s reason: nothing about the
 * request is malformed — the slug is well-formed and may well name a workflow in another
 * workspace — and nothing about it will succeed until the workspace changes, which is
 * `InvalidRequestError`'s own definition. A `404` would also be answering about a path that
 * exists.
 *
 * **Not a `403`, and the distinction is deliberate**: this says nothing about whether the slug
 * names a workflow *somewhere*, exactly as `queue_issues_not_found` declines to confirm that a
 * guessed issue id is real. What it discloses is this workspace's own vocabulary, which the
 * caller is entitled to.
 *
 * @param workflow - The slug the request named.
 * @param offered - What the workspace does have — `WorkflowRegistryService.offered()`'s slugs.
 * @returns The error to throw.
 */
export function queueWorkflowUnknown(
  workflow: string,
  offered: readonly string[],
): InvalidRequestError {
  return new InvalidRequestError(
    QUEUE_ERRORS.workflowUnknown,
    `This workspace has no workflow named ${workflow}.`,
    { workflow, offered } satisfies QueueWorkflowProblem,
  );
}

/**
 * `409` — the queue already speaks for some of these issues.
 *
 * Raised from the check *and* from the constraint. The check is what makes the answer
 * per-issue; the constraint is what makes it true — `constraints.ts`' argument in as many
 * words: *"a service that asks whether a domain is taken and then inserts it has a window
 * between the two, and the loser of that race gets a 500 with PostgreSQL's own text in it"*.
 * Here the loser gets this, with the id it sent.
 *
 * @param issues - One entry per conflicting issue. `issue_already_queued` for a row the queue
 *   holds, `issue_number_taken` for two issues in this selection sharing one number.
 * @returns The error to throw.
 */
export function queueIssuesConflict(issues: readonly QueueIssueProblem[]): ConflictError {
  return new ConflictError(
    QUEUE_ERRORS.conflict,
    "Some of those issues are already in the queue.",
    { issues },
  );
}
