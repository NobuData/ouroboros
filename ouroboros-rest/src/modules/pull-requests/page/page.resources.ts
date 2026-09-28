/**
 * What the PR page's reads and head actions send — AX.5
 * ([#361](https://github.com/NobuData/ouroboros/issues/361)), and the pure functions that shape the
 * repository's rows into it.
 *
 * ```
 * GET /pull-requests/514 ─▶ { pullRequest,                         ← the head: title, meta chips
 *                            revisions[{…, gates, correction}],    ← the strip; each its own snapshot
 *                            gates,                                ← the latest revision's card
 *                            criteria, files, thread, plan, spend, ← the other cards
 *                            review, loopReturn }                  ← the two head actions' state
 * ```
 *
 * **Every step of the strip is a join (decision V4).** A revision's test attempt is the one its own
 * `test_suite` verdict cites (`evidence_ref`, kind `test_run`) — *the attempt it was judged on* — and
 * the correction that led to it is read from the revision before: the classification on a case of
 * that revision's attempt, and any loop return sent from it. Nothing is inferred from timestamps.
 *
 * Timestamps are ISO 8601 strings; costs are decimal strings in cents, as the console sends them.
 */

import type {
  FailureClass,
  PrApprovalHostRequest,
  PrApprovalState,
  PrGateEvidenceRef,
  PrGateVerdict,
  PrRevisionFile,
  PrThreadAuthorKind,
  PrThreadTag,
  PullRequestState,
  RunStatus,
} from "../../db/schema";
import type { RunControlResource } from "../../controls/controls.resources";
import type { Page } from "../../tenancy/pagination";
import type { CriteriaMatrixResource } from "../criteria/criteria.resources";
import type { GateAggregate } from "../gates/gate.engine";
import type { MergePlanResource } from "../merge/merge.resources";
import type {
  ApprovalRow,
  ClassificationRow,
  GateRowRecord,
  LatestRevisionRow,
  LoopReturnRow,
  PersonRow,
  PrHeadRow,
  PrListRow,
  RevisionRow,
  TestAttemptRow,
  ThreadRows,
} from "./page.repository";
import type { SpendRollupResource } from "./page.spend";

/** The loop that opened a PR — `loop #1847`. */
export interface PrRunResource {
  readonly id: string;
  readonly loopSeq: number;
  readonly issueNumber: number;
  /** The loop's model — the strip's model pill. */
  readonly model: string;
  readonly workflowTag: string;
  readonly workflowVersionPin: number | null;
  readonly status: RunStatus;
  readonly finishedAt: string | null;
}

/** The ticket a PR closes — `issue #482`. */
export interface PrTicketResource {
  readonly id: string;
  /** The tracker's own key — `#482`, `HEL-12`. */
  readonly key: string;
  readonly title: string;
  readonly url: string;
}

/** A PR's head — what the page's `h1` and meta chips read. */
export interface PullRequestHeadResource {
  readonly id: string;
  readonly number: number;
  readonly url: string;
  readonly title: string;
  readonly state: PullRequestState;
  readonly headBranch: string;
  readonly baseBranch: string;
  readonly additions: number;
  readonly deletions: number;
  readonly changedFiles: number;
  readonly mergedAt: string | null;
  readonly mergedBy: string | null;
  readonly run: PrRunResource | null;
  readonly ticket: PrTicketResource | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** `pr_gate_aggregate` — `5 of 7 green`. */
export interface GateAggregateResource {
  readonly requiredCount: number;
  readonly greenCount: number;
  readonly redCount: number;
  readonly satisfiedCount: number;
  /** Every required gate satisfied — the merge precondition. */
  readonly mergeReady: boolean;
}

/** A revision, as a listing row names it. */
export interface RevisionRefResource {
  readonly id: string;
  readonly seq: number;
  readonly headSha: string;
  readonly pushedAt: string;
}

/** One row of `GET /api/v1/pull-requests`. */
export interface PullRequestSummaryResource extends PullRequestHeadResource {
  readonly latestRevision: RevisionRefResource | null;
  /** The latest revision's aggregate, or null when it has no snapshot yet. */
  readonly gates: GateAggregateResource | null;
  /** An approval slot is open — the PR needs a person. */
  readonly reviewRequested: boolean;
}

/** `GET /api/v1/pull-requests`. */
export type PullRequestListResource = Page<PullRequestSummaryResource>;

/** One gate's newest verdict on one revision. */
export interface GateRowResource {
  readonly key: string;
  readonly label: string;
  readonly required: boolean;
  readonly sortOrder: number;
  /** Why the PR has the gate — `standard-fix@v14 pin`. */
  readonly source: string;
  readonly verdict: PrGateVerdict;
  readonly evidence: string | null;
  readonly evidenceRef: PrGateEvidenceRef | null;
  readonly evaluatedAt: string;
  readonly providerVersion: string;
}

/** One revision's snapshot — the card, scoped to it. */
export interface GateSnapshotResource {
  readonly revisionId: string;
  /** The aggregate, or null when the revision was never evaluated. */
  readonly aggregate: GateAggregateResource | null;
  /** In the card's order. */
  readonly rows: readonly GateRowResource[];
}

/** A test attempt — `attempt 4`. */
export interface TestAttemptResource {
  readonly id: string;
  readonly attemptSeq: number;
}

/** A failure classification. */
export interface ClassificationResource {
  readonly id: string;
  readonly testRunId: string;
  readonly class: FailureClass;
  readonly subtype: string | null;
  /** The correction note — the strip's text, when a person wrote one. */
  readonly note: string | null;
  /** `heuristic`, `model:<id>` or `human` — the provenance the model pill needs. */
  readonly actor: string;
  readonly createdAt: string;
}

/** A *Return to loop*, as recorded. */
export interface LoopReturnResource {
  readonly id: string;
  readonly revisionId: string | null;
  readonly controlId: string;
  readonly gateKeys: readonly string[];
  /** The attempt the next revision is expected from, or null when the run had no stage. */
  readonly expected: { readonly stageKey: string; readonly attempt: number } | null;
  readonly requestedBy: string | null;
  readonly createdAt: string;
}

/** What bridged the previous revision to this one — the strip's *Correction round* step. */
export interface CorrectionResource {
  /** The revision corrected. */
  readonly fromRevisionId: string;
  /** The classification on a case of the previous revision's attempt, if any. */
  readonly classification: ClassificationResource | null;
  /** The newest loop return sent from the previous revision, if any. */
  readonly loopReturn: LoopReturnResource | null;
}

/** One revision of the strip. */
export interface RevisionResource extends RevisionRefResource {
  /** The attempt the revision's test verdict cites — `attempt 4`. */
  readonly testAttempt: TestAttemptResource | null;
  /** The stage attempt the push is linked to by sha (V052), or null. */
  readonly stageAttempt: { readonly stageKey: string; readonly attempt: number } | null;
  /** The run commit the head matches, or null. */
  readonly commitMessage: string | null;
  /** Its own gate snapshot. */
  readonly gates: GateSnapshotResource;
  /** What bridged the previous revision to this one; null on the first. */
  readonly correction: CorrectionResource | null;
}

/** The changed-files card — the latest revision's snapshot. */
export interface FilesResource {
  readonly revisionId: string;
  readonly additions: number;
  readonly deletions: number;
  readonly rows: readonly PrRevisionFile[];
  /** A bounded sample of the diff, or null. */
  readonly diffExcerpt: string | null;
  /** The full diff on the host. */
  readonly fullDiffUrl: string;
}

/** One entry of the review thread. */
export interface ThreadEntryResource {
  readonly id: string;
  readonly revisionId: string | null;
  /** `rev 1` — the revision's ordinal, or null for a PR-wide entry. */
  readonly revisionSeq: number | null;
  readonly authorKind: PrThreadAuthorKind;
  readonly authorName: string;
  readonly tag: PrThreadTag;
  readonly body: string;
  readonly blocking: boolean;
  readonly resolved: boolean;
  readonly resolutionBody: string | null;
  readonly simulated: boolean;
  readonly createdAt: string;
}

/** The review thread — `3 entries · 0 open`. */
export interface ThreadResource {
  readonly entryCount: number;
  readonly openCount: number;
  readonly entries: readonly ThreadEntryResource[];
}

/** A person. */
export interface PersonResource {
  readonly id: string;
  readonly name: string;
}

/** An approval slot. */
export interface ReviewResource {
  readonly id: string;
  readonly state: PrApprovalState;
  readonly requestedRevisionId: string | null;
  readonly requestedBy: PersonResource | null;
  readonly requestedAt: string;
  /** The SPI `requestReview` on the host, or null when nobody was asked there. */
  readonly host: {
    readonly reviewer: string;
    readonly state: PrApprovalHostRequest;
    readonly detail: string | null;
  } | null;
  readonly decidedRevisionId: string | null;
  readonly decidedBy: PersonResource | null;
  readonly decidedAt: string | null;
  readonly note: string | null;
}

/** `GET /api/v1/pull-requests/{id}` — the whole page. */
export interface PullRequestPageResource {
  readonly pullRequest: PullRequestHeadResource;
  /** Oldest first. */
  readonly revisions: readonly RevisionResource[];
  /** The latest revision's snapshot, or null when there is no revision. */
  readonly gates: GateSnapshotResource | null;
  readonly criteria: CriteriaMatrixResource;
  /** The latest revision's files, or null when there is no revision. */
  readonly files: FilesResource | null;
  readonly thread: ThreadResource;
  readonly plan: MergePlanResource;
  /** Null for a PR no loop opened. */
  readonly spend: SpendRollupResource | null;
  /** The newest approval slot, or null. */
  readonly review: ReviewResource | null;
  /** The newest loop return, or null. */
  readonly loopReturn: LoopReturnResource | null;
}

/** `POST …/return-to-loop`. */
export interface ReturnToLoopResource {
  /** The correction round AP.4 queued — `pending`, or `rejected` when the run has finished. */
  readonly control: RunControlResource;
  /** The steer's text — the selected gates' evidence. */
  readonly payload: string;
  readonly revisionId: string;
  /** The gates returned, in the card's order. */
  readonly gates: readonly string[];
  /** The record, or null when the control was rejected. */
  readonly loopReturn: LoopReturnResource | null;
  /** What did not happen, and why. */
  readonly skipped: readonly string[];
}

/** `POST …/request-review` and `POST …/approvals`. */
export interface ReviewOutcomeResource {
  readonly review: ReviewResource;
  /** Whether this call opened the slot (request-review) — false when one was already open. */
  readonly created: boolean;
  /** Human approval on the latest revision after re-evaluation, or null if it has no verdict. */
  readonly humanApproval: GateRowResource | null;
  /** The latest revision's aggregate after re-evaluation, or null. */
  readonly aggregate: GateAggregateResource | null;
}

/**
 * @param value - A date, or null.
 * @returns ISO 8601, or null.
 */
function iso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

/**
 * @param row - A PR with its run and ticket.
 * @returns The head.
 */
export function headResource(row: PrHeadRow): PullRequestHeadResource {
  return {
    id: row.id,
    number: row.number,
    url: row.url,
    title: row.title,
    state: row.state,
    headBranch: row.headBranch,
    baseBranch: row.baseBranch,
    additions: row.additions,
    deletions: row.deletions,
    changedFiles: row.changedFiles,
    mergedAt: iso(row.mergedAt),
    mergedBy: row.mergedBy,
    run: row.run === null ? null : { ...row.run, finishedAt: iso(row.run.finishedAt) },
    ticket: row.ticket,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * @param row - A revision.
 * @returns Its reference.
 */
function revisionRef(row: LatestRevisionRow): RevisionRefResource {
  return { id: row.id, seq: row.seq, headSha: row.headSha, pushedAt: row.pushedAt.toISOString() };
}

/**
 * @param aggregate - `pr_gate_aggregate`'s answer.
 * @returns It, as sent.
 */
export function aggregateResource(aggregate: GateAggregate): GateAggregateResource {
  return { ...aggregate };
}

/**
 * @param row - A listing row.
 * @param aggregate - Its latest revision's aggregate, if any.
 * @returns The summary.
 */
export function summaryResource(
  row: PrListRow,
  aggregate: GateAggregate | undefined,
): PullRequestSummaryResource {
  return {
    ...headResource(row),
    latestRevision: row.latestRevision === null ? null : revisionRef(row.latestRevision),
    gates:
      aggregate === undefined || row.latestRevision === null ? null : aggregateResource(aggregate),
    reviewRequested: row.reviewRequested,
  };
}

/**
 * @param row - A gate's newest verdict.
 * @returns It, as sent.
 */
export function gateRowResource(row: GateRowRecord): GateRowResource {
  return {
    key: row.key,
    label: row.label,
    required: row.required,
    sortOrder: row.sortOrder,
    source: row.source,
    verdict: row.verdict,
    evidence: row.evidence,
    evidenceRef: row.evidenceRef,
    evaluatedAt: row.evaluatedAt.toISOString(),
    providerVersion: row.providerVersion,
  };
}

/**
 * @param row - A loop return.
 * @returns It, as sent.
 */
export function loopReturnResource(row: LoopReturnRow): LoopReturnResource {
  return {
    id: row.id,
    revisionId: row.revisionId,
    controlId: row.controlId,
    gateKeys: row.gateKeys,
    expected:
      row.expectedStageKey === null || row.expectedAttempt === null
        ? null
        : { stageKey: row.expectedStageKey, attempt: row.expectedAttempt },
    requestedBy: row.requestedBy,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * @param row - A classification.
 * @returns It, as sent.
 */
function classificationResource(row: ClassificationRow): ClassificationResource {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

/**
 * @param row - A person, or null.
 * @returns It, as sent.
 */
function personResource(row: PersonRow | null): PersonResource | null {
  return row === null ? null : { id: row.id, name: row.name };
}

/**
 * @param row - An approval slot.
 * @returns It, as sent.
 */
export function reviewResource(row: ApprovalRow): ReviewResource {
  return {
    id: row.id,
    state: row.state,
    requestedRevisionId: row.requestedRevisionId,
    requestedBy: personResource(row.requestedBy),
    requestedAt: row.requestedAt.toISOString(),
    host:
      row.hostReviewer === null || row.hostRequest === null
        ? null
        : { reviewer: row.hostReviewer, state: row.hostRequest, detail: row.hostDetail },
    decidedRevisionId: row.decidedRevisionId,
    decidedBy: personResource(row.decidedBy),
    decidedAt: iso(row.decidedAt),
    note: row.note,
  };
}

/**
 * @param rows - The thread and its counts.
 * @returns The card.
 */
export function threadResource(rows: ThreadRows): ThreadResource {
  return {
    entryCount: rows.entryCount,
    openCount: rows.openCount,
    entries: rows.entries.map((entry) => ({ ...entry, createdAt: entry.createdAt.toISOString() })),
  };
}

/**
 * The test attempt a revision's snapshot cites — its `test_suite` verdict's `test_run` link.
 *
 * @param rows - The revision's gate rows.
 * @returns The attempt's id, or undefined.
 */
export function citedTestRunId(rows: readonly GateRowRecord[]): string | undefined {
  const tests = rows.find((row) => row.key === "test_suite");

  return tests?.evidenceRef?.kind === "test_run" ? tests.evidenceRef.id : undefined;
}

/** What {@link stripResources} joins. */
export interface StripInput {
  readonly revisions: readonly RevisionRow[];
  readonly gateRows: readonly GateRowRecord[];
  readonly aggregates: ReadonlyMap<string, GateAggregate>;
  readonly attempts: ReadonlyMap<string, TestAttemptRow>;
  /** By test run id. */
  readonly classifications: ReadonlyMap<string, ClassificationRow>;
  /** Newest first. */
  readonly loopReturns: readonly LoopReturnRow[];
}

/**
 * The strip — every revision with its own snapshot, its attempt and the correction before it.
 *
 * @param input - The rows.
 * @returns The revisions, oldest first.
 */
export function stripResources(input: StripInput): RevisionResource[] {
  const byRevision = new Map<string, GateRowRecord[]>();

  for (const row of input.gateRows) {
    byRevision.set(row.revisionId, [...(byRevision.get(row.revisionId) ?? []), row]);
  }

  return input.revisions.map((revision, index) => {
    const rows = byRevision.get(revision.id) ?? [];
    const testRunId = citedTestRunId(rows);
    const previous = index === 0 ? undefined : input.revisions[index - 1];
    let correction: CorrectionResource | null = null;

    if (previous !== undefined) {
      const previousRun = citedTestRunId(byRevision.get(previous.id) ?? []);
      const classification =
        previousRun === undefined ? undefined : input.classifications.get(previousRun);
      const loopReturn = input.loopReturns.find((row) => row.revisionId === previous.id);

      correction = {
        fromRevisionId: previous.id,
        classification:
          classification === undefined ? null : classificationResource(classification),
        loopReturn: loopReturn === undefined ? null : loopReturnResource(loopReturn),
      };
    }

    const aggregate = input.aggregates.get(revision.id);
    const attempt = testRunId === undefined ? undefined : input.attempts.get(testRunId);

    return {
      ...revisionRef(revision),
      testAttempt:
        attempt === undefined ? null : { id: attempt.id, attemptSeq: attempt.attemptSeq },
      stageAttempt: revision.stageAttempt,
      commitMessage: revision.commitMessage,
      gates: {
        revisionId: revision.id,
        aggregate:
          rows.length === 0 || aggregate === undefined ? null : aggregateResource(aggregate),
        rows: rows.map(gateRowResource),
      },
      correction,
    };
  });
}

/**
 * The changed-files card.
 *
 * @param revision - The latest revision.
 * @param prUrl - The PR's page on the host.
 * @returns The card.
 */
export function filesResource(revision: RevisionRow, prUrl: string): FilesResource {
  return {
    revisionId: revision.id,
    additions: revision.files.reduce((sum, file) => sum + file.additions, 0),
    deletions: revision.files.reduce((sum, file) => sum + file.deletions, 0),
    rows: revision.files,
    diffExcerpt: revision.diffExcerpt,
    fullDiffUrl: `${prUrl.replace(/\/+$/, "")}/files`,
  };
}
