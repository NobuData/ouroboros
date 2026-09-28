/**
 * The PR verification page's read, its by-run lookup and its two head actions
 * ([#363](https://github.com/NobuData/ouroboros/issues/363), over AX.5's
 * [#361](https://github.com/NobuData/ouroboros/issues/361)).
 *
 * ```
 * GET  /api/v1/pull-requests/{id}                  the whole page — head, gates, plan, review
 * GET  /api/v1/pull-requests?runId=…,…             the PRs those runs opened — the by-run lookup
 * POST /api/v1/pull-requests/{id}/request-review   Request human review
 * POST /api/v1/pull-requests/{id}/return-to-loop   Return to loop, with the selected red gates
 * POST /api/v1/pull-requests/{id}/approvals        Approve or decline — the gates card's row (#365)
 * POST /api/v1/pull-requests/{id}/criteria                        Add claim (#366, over #359)
 * POST /api/v1/pull-requests/{id}/criteria/import                 Import from plan
 * POST /api/v1/pull-requests/{id}/criteria/{criterionId}/evidence Cite evidence
 * POST /api/v1/pull-requests/{id}/criteria/{criterionId}/verify   Verify
 * POST /api/v1/pull-requests/{id}/criteria/{criterionId}/waive    Waive, and annotate the host PR
 * ```
 *
 * The shape every other module under `app/api/` keeps: the generated client does the transport,
 * `unwrap` turns a non-2xx into an `ApiError`, and a caller that already holds a client — a poll
 * route's anonymous one — passes it in.
 */

import { type ApiClient, unwrap } from "@/app/api/client";
import type { components } from "@/app/api/schema";
import { api } from "@/app/api/server";

/** Every region of the PR page. */
export type PullRequestPage = components["schemas"]["PullRequestPage"];

/** The PR's head — the `h1` and the meta row. */
export type PullRequestHead = components["schemas"]["PullRequestHead"];

/** `open`, `verifying`, `blocked`, `armed`, `merged` or `closed`. */
export type PullRequestState = PullRequestHead["state"];

/** One row of the listing. */
export type PullRequestSummary = components["schemas"]["PullRequestSummary"];

/** One revision of the PR. */
export type PrRevision = components["schemas"]["PrRevision"];

/** One gate's newest verdict on one revision. */
export type PrGateRow = components["schemas"]["PrGateRow"];

/** `5 of 7 green`. */
export type PrGateAggregate = components["schemas"]["PrGateAggregate"];

/** The newest approval slot. */
export type PrReview = components["schemas"]["PrReview"];

/** What *Return to loop* sends. */
export type ReturnToLoopRequest = components["schemas"]["ReturnToLoopRequest"];

/** What *Return to loop* answers. */
export type ReturnToLoop = components["schemas"]["ReturnToLoop"];

/** What *Request human review* answers. */
export type PrReviewOutcome = components["schemas"]["PrReviewOutcome"];

/** What an approval slot is answered with — the decision, and its note. */
export type ApprovalDecisionRequest = components["schemas"]["ApprovalDecisionRequest"];

/** `approve` or `decline`. */
export type ApprovalDecision = ApprovalDecisionRequest["decision"];

/** The acceptance criteria matrix — every claim, in the card's order. */
export type CriteriaMatrix = components["schemas"]["CriteriaMatrix"];

/** One claim of the matrix, with its evidence and — when waived — its waiver. */
export type PrCriterion = components["schemas"]["PrCriterion"];

/** One citation of a claim: the composed line and the typed reference. */
export type PrEvidence = components["schemas"]["PrEvidence"];

/** `test_case`, `hil_measurement`, `hunk`, `analysis_note` or `build_artifact`. */
export type PrEvidenceKind = PrEvidence["kind"];

/** What citing evidence sends — one typed reference. */
export type AttachEvidenceRequest = components["schemas"]["AttachEvidenceRequest"];

/** What *Import from plan* answers. */
export type CriteriaImport = components["schemas"]["CriteriaImport"];

/** What a waive answers: the waived claim, and what the host did with the annotation. */
export type PrCriterionWaived = components["schemas"]["PrCriterionWaived"];

/** The changed-files snapshot of the latest revision. */
export type PrFiles = components["schemas"]["PrFiles"];

/** A run's pull request, as a surface that links to its verification page holds it. */
export interface PullRequestRef {
  /** The PR's id — what its verification page is addressed by. */
  readonly id: string;
  /** The host's number — `514`. */
  readonly number: number;
}

/** A PR's, a run's or a revision's id: a uuid. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The most PRs one by-run lookup reads, and the most runs it names — the listing's ceilings. */
export const RUN_PRS_LIMIT = 100;

/**
 * Whether a value can be a PR's id — checked by every hop that puts one in a path itself, for
 * the reason `isRunId` gives.
 *
 * @param value What arrived.
 * @returns `true` for a uuid.
 */
export function isPullRequestId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/**
 * The newest PR of each run.
 *
 * @param rows PRs, in any order — each naming the run that opened it, or none.
 * @returns For every run that opened one, the PR created last — `test-results-read`'s rule for a
 *   loop that opened more than one. A PR no run opened is left out.
 */
export function newestByRun(
  rows: readonly PullRequestSummary[],
): ReadonlyMap<string, PullRequestSummary> {
  const newest = new Map<string, PullRequestSummary>();

  for (const row of rows) {
    if (row.run === null) continue;

    const held = newest.get(row.run.id);

    if (held === undefined || Date.parse(row.createdAt) > Date.parse(held.createdAt)) {
      newest.set(row.run.id, row);
    }
  }

  return newest;
}

export const pullRequests = {
  /**
   * Read the whole PR page.
   *
   * @param id The PR's id.
   * @param client The client to ask through. Defaults to the request-scoped one.
   * @param signal Aborts the read — the poll route's timeout.
   * @returns Every region's data.
   * @throws ApiError `404 pull_request_not_found` for a PR that is not this workspace's.
   */
  async page(id: string, client: ApiClient = api(), signal?: AbortSignal): Promise<PullRequestPage> {
    return unwrap(
      await client.GET("/api/v1/pull-requests/{id}", {
        params: { path: { id } },
        signal,
      }),
    );
  },

  /**
   * Find the PRs some runs opened — one request, however many runs.
   *
   * @param runIds The runs' ids — at most {@link RUN_PRS_LIMIT}; the rest are not asked about.
   * @param client The client to ask through. Defaults to the request-scoped one.
   * @returns Each run's newest PR, by run id. A run that opened none — or is not this
   *   workspace's, which the service answers the same way — has no entry. No runs is no request.
   * @throws ApiError `422` for a run id that is not a uuid.
   */
  async forRuns(
    runIds: readonly string[],
    client: ApiClient = api(),
  ): Promise<ReadonlyMap<string, PullRequestSummary>> {
    const asked = [...new Set(runIds)].slice(0, RUN_PRS_LIMIT);
    if (asked.length === 0) return new Map();

    const listed = unwrap(
      await client.GET("/api/v1/pull-requests", {
        params: { query: { runId: asked, limit: RUN_PRS_LIMIT } },
      }),
    );

    return newestByRun(listed.items);
  },

  /**
   * Request a human review of a PR — human approval becomes required and pending.
   *
   * @param id The PR's id.
   * @param client The client to ask through. Defaults to the request-scoped one.
   * @returns The approval slot, whether this call opened it, and the re-evaluated gate.
   * @throws ApiError `403` for a viewer, `409 pull_request_not_open`, `404 pull_request_not_found`.
   */
  async requestReview(id: string, client: ApiClient = api()): Promise<PrReviewOutcome> {
    return unwrap(
      await client.POST("/api/v1/pull-requests/{id}/request-review", {
        params: { path: { id } },
        body: {},
      }),
    );
  },

  /**
   * Answer a PR's approval slot on its latest revision — the human-approval gate re-evaluates.
   *
   * @param id The PR's id.
   * @param request The decision, and its note — required on a decline.
   * @param client The client to ask through. Defaults to the request-scoped one.
   * @returns The answered slot, whether this call opened it, and the re-evaluated gate.
   * @throws ApiError `403` for a viewer, `422 pr_decline_note_required`,
   *   `409 pull_request_not_open`, `404 pull_request_not_found`.
   */
  async decideApproval(
    id: string,
    request: ApprovalDecisionRequest,
    client: ApiClient = api(),
  ): Promise<PrReviewOutcome> {
    return unwrap(
      await client.POST("/api/v1/pull-requests/{id}/approvals", {
        params: { path: { id } },
        body: request,
      }),
    );
  },

  /**
   * Author one claim — `manual`, the only provenance authoring writes.
   *
   * @param id The PR's id.
   * @param claim The claim, neither empty nor padded.
   * @param client The client to ask through. Defaults to the request-scoped one.
   * @returns The claim, last in the matrix and `unverified`.
   * @throws ApiError `403` for a viewer, `404 pull_request_not_found`.
   */
  async createCriterion(id: string, claim: string, client: ApiClient = api()): Promise<PrCriterion> {
    return unwrap(
      await client.POST("/api/v1/pull-requests/{id}/criteria", {
        params: { path: { id } },
        body: { claim },
      }),
    );
  },

  /**
   * Import the acceptance criteria the ticket's plan states, as `plan` rows.
   *
   * @param id The PR's id.
   * @param client The client to ask through. Defaults to the request-scoped one.
   * @returns What was written, what the PR already had, and what was too long to be a claim.
   * @throws ApiError `403` for a viewer, `409 plan_context_missing` or `plan_criteria_missing`,
   *   `404 pull_request_not_found`.
   */
  async importCriteria(id: string, client: ApiClient = api()): Promise<CriteriaImport> {
    return unwrap(
      await client.POST("/api/v1/pull-requests/{id}/criteria/import", {
        params: { path: { id } },
      }),
    );
  },

  /**
   * Cite one piece of evidence for a claim — a typed reference the service resolves first.
   *
   * @param id The PR's id.
   * @param criterionId The claim's id.
   * @param request The reference.
   * @param client The client to ask through. Defaults to the request-scoped one.
   * @returns The claim, with the citation — and its composed line — among its evidence.
   * @throws ApiError `403` for a viewer, `422 evidence_unresolved` or `hunk_outside_snapshot`,
   *   `404 criterion_not_found` or `pull_request_not_found`.
   */
  async attachEvidence(
    id: string,
    criterionId: string,
    request: AttachEvidenceRequest,
    client: ApiClient = api(),
  ): Promise<PrCriterion> {
    return unwrap(
      await client.POST("/api/v1/pull-requests/{id}/criteria/{criterionId}/evidence", {
        params: { path: { id, criterionId } },
        body: request,
      }),
    );
  },

  /**
   * Mark a claim verified — refused while it has no evidence.
   *
   * @param id The PR's id.
   * @param criterionId The claim's id.
   * @param client The client to ask through. Defaults to the request-scoped one.
   * @returns The claim, `verified`.
   * @throws ApiError `403` for a viewer, `409 criterion_evidence_required` or `criterion_waived`,
   *   `404 criterion_not_found` or `pull_request_not_found`.
   */
  async verifyCriterion(
    id: string,
    criterionId: string,
    client: ApiClient = api(),
  ): Promise<PrCriterion> {
    return unwrap(
      await client.POST("/api/v1/pull-requests/{id}/criteria/{criterionId}/verify", {
        params: { path: { id, criterionId } },
      }),
    );
  },

  /**
   * Waive a claim and annotate the host PR. Waiving again edits the same host comment.
   *
   * @param id The PR's id.
   * @param criterionId The claim's id.
   * @param reason Why, neither empty nor padded.
   * @param client The client to ask through. Defaults to the request-scoped one.
   * @returns The claim, `waived`, and what the host did with the annotation — a host that
   *   refused is an answer, not an error.
   * @throws ApiError `403` for anyone but an owner or admin, `409 criterion_waiver_needs_run`,
   *   `404 criterion_not_found` or `pull_request_not_found`.
   */
  async waiveCriterion(
    id: string,
    criterionId: string,
    reason: string,
    client: ApiClient = api(),
  ): Promise<PrCriterionWaived> {
    return unwrap(
      await client.POST("/api/v1/pull-requests/{id}/criteria/{criterionId}/waive", {
        params: { path: { id, criterionId } },
        body: { reason },
      }),
    );
  },

  /**
   * Send the selected red gates' evidence back to the loop as a correction round.
   *
   * @param id The PR's id.
   * @param request The gates, the revision they were selected on, and optionally a note and a
   *   replay key.
   * @param client The client to ask through. Defaults to the request-scoped one.
   * @returns The queued control, the steer's text and the recorded expectation.
   * @throws ApiError `403` for a viewer, `422 pr_gate_not_red`, `409 pull_request_not_open` or
   *   `pull_request_has_no_run`, `404 pull_request_not_found`.
   */
  async returnToLoop(
    id: string,
    request: ReturnToLoopRequest,
    client: ApiClient = api(),
  ): Promise<ReturnToLoop> {
    return unwrap(
      await client.POST("/api/v1/pull-requests/{id}/return-to-loop", {
        params: { path: { id } },
        body: request,
      }),
    );
  },
};
