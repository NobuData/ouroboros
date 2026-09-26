/**
 * What the classification & routing routes answer with — AT.4
 * ([#332](https://github.com/NobuData/ouroboros/issues/332)).
 *
 * The Mark & Route card reads three things from here: the heuristic hint and why each rule did or
 * did not fire ({@link TestRunHintsResource}), the decision with its **routing receipt**
 * ({@link ClassificationResource}), and what the routing actually did, including what it could
 * not do ({@link RoutingResource}). *"Could not"* is part of the answer rather than an error: a
 * classification is recorded whether or not the farm had a build to re-run.
 */

import type { RunControlResource } from "../controls/controls.resources";
import type {
  ClassificationReceipt,
  FailureClass,
  FailureSubtype,
  TestCaseStatus,
  TestSelectionScope,
} from "../db/schema";
import type { BuildJobResource, DispatchQueueState } from "../farm/dispatch/jobs.resources";
import type { TriageResponse } from "./triage.contract";
import type { ClassificationRow, WaiverRow } from "./triage.repository";
import type { Hint, RuleVerdict } from "./triage.rules";

/** One failing case's hint. */
export interface CaseHintResource {
  readonly caseId: string;
  readonly caseKey: string;
  readonly name: string;
  readonly suite: string;
  readonly status: TestCaseStatus;
  /** The first rule that fired, or null — `confidence` is always null and `actor` `heuristic`. */
  readonly hint: Hint | null;
  /** Every rule's verdict, in precedence order. */
  readonly rules: readonly RuleVerdict[];
  /** The hint in `/v0/triage`'s response shape — the door AV.1's model answers behind. */
  readonly triage: TriageResponse | null;
}

/** `GET /api/v1/test-runs/{id}/hints`. */
export interface TestRunHintsResource {
  readonly testRunId: string;
  readonly cases: readonly CaseHintResource[];
}

/** A classification's routing receipt, as the UI reads it. */
export interface ReceiptResource {
  /** The correction round's control (`run_controls.id`). */
  readonly controlId: string | null;
  /** The re-run's build (`build_jobs.id`). */
  readonly rerunJobId: string | null;
  /** The attempt the correction round opens — *"→ attempt 4"*. */
  readonly targetAttempt: number | null;
  /** Which route wrote it. */
  readonly route: string | null;
}

/** One classification — `failure_classifications`. */
export interface ClassificationResource {
  readonly id: string;
  readonly testCaseId: string;
  readonly class: FailureClass;
  readonly subtype: FailureSubtype | null;
  readonly note: string | null;
  readonly actor: "human" | "heuristic" | "model";
  readonly ruleId: string | null;
  /** Model only; null for a person and for a heuristic. */
  readonly confidence: number | null;
  /** What was dispatched, or null when nothing was. */
  readonly routed: ReceiptResource | null;
  readonly createdBy: string | null;
  readonly createdAt: string;
  /** The classification that replaced this one; null for the current decision. */
  readonly supersededBy: string | null;
}

/** `GET /api/v1/test-runs/{id}/classifications` — each classified case's current decision. */
export interface ClassificationsListResource {
  readonly testRunId: string;
  readonly classifications: readonly ClassificationResource[];
}

/** A re-run just dispatched. */
export interface RerunResource {
  readonly testRunId: string;
  readonly scope: TestSelectionScope;
  /** The cases the job carries, by `case_key` — only the failed set for `failed`. */
  readonly caseKeys: readonly string[];
  readonly job: BuildJobResource;
  /** Never *"started"*: `offered`, `queued_runner_available` or `queued_no_eligible_runner`. */
  readonly queueState: DispatchQueueState;
}

/** The runner an `infra_rig` classification flagged. */
export interface RunnerFlagResource {
  readonly runnerId: string;
  readonly runnerName: string | null;
  readonly note: string;
  readonly notedAt: string;
}

/** Which of decision T7's compositions a class routes to. */
export type Route = "correction_round" | "flake_retry" | "infra_rig";

/** What routing did. Fields a route does not use are null. */
export interface RoutingResource {
  readonly route: Route;
  /** The correction round's steer (`retryStage: true`). */
  readonly control: RunControlResource | null;
  /** The attempt the correction round opens, or null before any stage has started. */
  readonly targetAttempt: number | null;
  /** The flake route's history mark: whether this call recorded the occurrence. */
  readonly historyMarked: boolean | null;
  /** The flake route's re-run, or the infra route's requeue. */
  readonly rerun: RerunResource | null;
  /** The infra route's runner flag. */
  readonly runnerFlag: RunnerFlagResource | null;
  /** What routing could not do, and why — an honest answer, not an error. */
  readonly skipped: readonly string[];
}

/** `POST /api/v1/test-runs/{id}/cases/{caseId}/classify`. */
export interface ClassifyResultResource {
  readonly classification: ClassificationResource;
  readonly routing: RoutingResource;
}

/** `POST /api/v1/test-runs/{id}/waivers`. */
export interface WaiverResource {
  readonly id: string;
  readonly runId: string;
  readonly testRunId: string;
  readonly author: string | null;
  readonly reason: string;
  readonly caseKeys: readonly string[];
  /** `pending_pr_plane` — the PR annotation is AV.2's (#344) and is not attempted. */
  readonly annotationState: "pending_pr_plane";
  readonly createdAt: string;
}

/**
 * A classification row as the API describes it.
 *
 * @param row - The row.
 * @returns The resource.
 */
export function classificationResource(row: ClassificationRow): ClassificationResource {
  return {
    id: row.id,
    testCaseId: row.test_case_id,
    class: row.class,
    subtype: row.subtype,
    note: row.note,
    actor: row.actor,
    ruleId: row.rule_id,
    confidence: row.confidence === null ? null : Number(row.confidence),
    routed: row.routed === null ? null : receiptResource(row.routed),
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    supersededBy: row.superseded_by,
  };
}

/**
 * A stored receipt as the UI reads it.
 *
 * @param receipt - `failure_classifications.routed`.
 * @returns The resource; a key the receipt lacks is null.
 */
export function receiptResource(receipt: ClassificationReceipt): ReceiptResource {
  return {
    controlId: typeof receipt.control_id === "string" ? receipt.control_id : null,
    rerunJobId: typeof receipt.rerun_job_id === "string" ? receipt.rerun_job_id : null,
    targetAttempt: typeof receipt.target_attempt === "number" ? receipt.target_attempt : null,
    route: typeof receipt.route === "string" ? receipt.route : null,
  };
}

/**
 * A waiver row as the API describes it.
 *
 * @param row - The row.
 * @param testRunId - The attempt it was recorded from.
 * @returns The resource.
 */
export function waiverResource(row: WaiverRow, testRunId: string): WaiverResource {
  return {
    id: row.id,
    runId: row.run_id,
    testRunId,
    author: row.author,
    reason: row.reason,
    caseKeys: row.case_keys,
    annotationState: row.annotation_state,
    createdAt: row.created_at.toISOString(),
  };
}
