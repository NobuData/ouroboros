import type {
  PrGateRow,
  PrReview,
  PrRevision,
  PullRequestHead,
  PullRequestPage,
  PullRequestSummary,
  ReturnToLoop,
} from "@/app/api/pull-requests";

import { SEEDED_RUN_ID } from "./runs";

/**
 * The seeded PR `#514` (#363) as AX.5's page states it — mockup 12's figures: `verifying`, `5 of 7
 * gates green` on Revision 2, opened by loop `#1847` for issue `#482`, `+68 −15 · 3 files`.
 * Revision 1 is the blocked one: the test suite and the physical HIL gates red.
 */

/** PR #514's id. */
export const PR_514_ID = "5eed003a-0000-4000-8000-000000000514";

/** Revision 1's id. */
export const REV_1_ID = "5eed003b-0000-4000-8000-000000005141";

/** Revision 2's id — the latest. */
export const REV_2_ID = "5eed003b-0000-4000-8000-000000005142";

/** PR #514 on its host. */
export const HOST_URL = "https://github.com/acme-robotics/helios-firmware/pull/514";

/** Issue #482 on its tracker. */
export const TICKET_URL = "https://github.com/acme-robotics/helios-firmware/issues/482";

/** Revision 1's red test line. */
export const TESTS_RED = "61/63 · 2 failing after attempt 3";

/** Revision 1's red HIL line. */
export const HIL_RED = "overshoot 2.4% > 2.0% · rig helios-rig-02";

/** Ken, who asks for reviews. */
export const KEN = { id: "5eed0003-0000-4000-8000-000000000001", name: "Ken S" };

/** The seven gates, in the card's order, as `[key, label]`. */
const GATES: readonly (readonly [string, string])[] = [
  ["build", "Build"],
  ["test_suite", "Test suite"],
  ["physical_hil", "Physical HIL"],
  ["diff_vs_plan", "Diff vs plan"],
  ["secrets_license", "Secrets & license"],
  ["model_review", "Second-model review"],
  ["human_approval", "Human approval"],
];

/**
 * One gate row.
 *
 * @param key The gate.
 * @param verdict Its verdict.
 * @param evidence Its evidence line.
 * @returns The row.
 */
export function gateRow(
  key: string,
  verdict: PrGateRow["verdict"],
  evidence: string | null = `${verdict} by the seed`,
): PrGateRow {
  const index = GATES.findIndex(([each]) => each === key);

  return {
    key,
    label: GATES[index]?.[1] ?? key,
    required: true,
    sortOrder: index + 1,
    source: "standard-fix@v14 pin",
    verdict,
    evidence,
    evidenceRef: null,
    evaluatedAt: "2026-09-27T14:32:00.000Z",
    providerVersion: "gate-seed@1.0.0",
  };
}

/**
 * Revision 2's rows — five green, the second-model review unavailable, human approval not
 * required.
 *
 * @param over Verdicts and evidence to replace, by gate key.
 * @returns The seven rows, in the card's order.
 */
export function gateRows(
  over: Readonly<Record<string, readonly [PrGateRow["verdict"], string | null]>> = {},
): PrGateRow[] {
  const seeded: Record<string, readonly [PrGateRow["verdict"], string | null]> = {
    build: ["green", "forge-01 · zephyr.elf · FLASH 43.5%"],
    test_suite: ["green", "63/63 after attempt 4"],
    physical_hil: ["green", "overshoot 1.7% ≤ 2.0% · rig helios-rig-02"],
    diff_vs_plan: ["green", "all hunks map to planned files · 0 out-of-scope edits"],
    secrets_license: ["green", "clean (headers + manifest delta)"],
    model_review: ["unavailable", "unavailable — arrives with the provider stack"],
    human_approval: ["not_required", "not required by policy"],
    ...over,
  };

  return GATES.map(([key]) => gateRow(key, seeded[key]![0], seeded[key]![1]));
}

/**
 * A revision.
 *
 * @param over What to change.
 * @returns Revision 2, changed.
 */
export function revision(over: Partial<PrRevision> = {}): PrRevision {
  return {
    id: REV_2_ID,
    seq: 2,
    headSha: "b7e41d0",
    pushedAt: "2026-09-27T14:30:00.000Z",
    testAttempt: null,
    stageAttempt: null,
    commitMessage: null,
    gates: { revisionId: over.id ?? REV_2_ID, aggregate: null, rows: [] },
    correction: null,
    ...over,
  };
}

/**
 * The PR's head.
 *
 * @param over What to change.
 * @returns PR #514's head, changed.
 */
export function prHeadOf(over: Partial<PullRequestHead> = {}): PullRequestHead {
  return {
    id: PR_514_ID,
    number: 514,
    url: HOST_URL,
    title: "can: fix flaky telemetry frame order under ISR load",
    state: "verifying",
    headBranch: "loop/482-canbus-flake",
    baseBranch: "main",
    additions: 68,
    deletions: 15,
    changedFiles: 3,
    mergedAt: null,
    mergedBy: null,
    run: {
      id: SEEDED_RUN_ID,
      loopSeq: 1847,
      issueNumber: 482,
      model: "claude-fable-5",
      workflowTag: "standard-fix",
      workflowVersionPin: 14,
      status: "coding",
      finishedAt: null,
    },
    ticket: {
      id: "5eed0030-0000-4000-8000-000000000482",
      key: "#482",
      title: "Fix flaky CAN-bus telemetry test",
      url: TICKET_URL,
    },
    createdAt: "2026-09-27T14:10:00.000Z",
    updatedAt: "2026-09-27T14:32:00.000Z",
    ...over,
  };
}

/**
 * The page.
 *
 * @param over What to change: the head's fields, and any region.
 * @returns PR #514's page, changed.
 */
export function prPage(
  over: Partial<Omit<PullRequestPage, "pullRequest">> & {
    readonly pullRequest?: Partial<PullRequestHead>;
  } = {},
): PullRequestPage {
  const { pullRequest, ...regions } = over;

  return {
    revisions: [revision({ id: REV_1_ID, seq: 1, headSha: "3f9c2ae" }), revision()],
    gates: {
      revisionId: REV_2_ID,
      aggregate: {
        requiredCount: 7,
        greenCount: 5,
        redCount: 0,
        satisfiedCount: 6,
        mergeReady: false,
      },
      rows: gateRows(),
    },
    criteria: {
      prId: PR_514_ID,
      counts: { total: 0, verified: 0, waived: 0, unverified: 0 },
      criteria: [],
    },
    files: null,
    thread: { entryCount: 0, openCount: 0, entries: [] },
    plan: {
      prId: PR_514_ID,
      strategy: "squash",
      deleteBranch: true,
      commitMessage: "can: fix flaky telemetry frame order under ISR load\n\nCloses #482.",
      closeTicket: true,
      commentEvidence: true,
      backAnnotateEpic: false,
      epicId: null,
      armed: false,
      armedBy: null,
      armedAt: null,
      armedAgainstRevisionId: null,
      disarmReason: null,
      mergedResult: null,
      updatedAt: "2026-09-27T14:32:00.000Z",
    },
    spend: null,
    review: null,
    loopReturn: null,
    ...regions,
    pullRequest: prHeadOf(pullRequest),
  };
}

/**
 * The page while Revision 2 is blocked the way the mockup's Revision 1 was: the test suite and the
 * physical HIL gates red.
 *
 * @param over What else to change.
 * @returns The blocked page.
 */
export function blockedPage(over: Parameters<typeof prPage>[0] = {}): PullRequestPage {
  return prPage({
    gates: {
      revisionId: REV_2_ID,
      aggregate: {
        requiredCount: 7,
        greenCount: 3,
        redCount: 2,
        satisfiedCount: 4,
        mergeReady: false,
      },
      rows: gateRows({ test_suite: ["red", TESTS_RED], physical_hil: ["red", HIL_RED] }),
    },
    ...over,
    pullRequest: { state: "blocked", ...over.pullRequest },
  });
}

/**
 * An approval slot.
 *
 * @param over What to change.
 * @returns A slot Ken opened on Revision 2, waiting, changed.
 */
export function review(over: Partial<PrReview> = {}): PrReview {
  return {
    id: "5eed003c-0000-4000-8000-000000000001",
    state: "requested",
    requestedRevisionId: REV_2_ID,
    requestedBy: KEN,
    requestedAt: "2026-09-27T14:40:00.000Z",
    host: null,
    decidedRevisionId: null,
    decidedBy: null,
    decidedAt: null,
    note: null,
    ...over,
  };
}

/**
 * What *Return to loop* answers.
 *
 * @param over What to change.
 * @returns A queued correction round carrying both red gates, changed.
 */
export function returned(over: Partial<ReturnToLoop> = {}): ReturnToLoop {
  const controlId = "5eed003d-0000-4000-8000-000000000001";

  return {
    control: {
      id: controlId,
      runId: SEEDED_RUN_ID,
      kind: "steer",
      state: "pending",
      requestedBy: KEN.id,
      requestedAt: "2026-09-27T14:41:00.000Z",
      deliveredAt: null,
      ackedAt: null,
      expiresAt: "2026-09-27T14:51:00.000Z",
      detail: null,
      hasPayload: true,
      remember: false,
      retryStage: true,
    } as ReturnToLoop["control"],
    payload: `test_suite: ${TESTS_RED}\nphysical_hil: ${HIL_RED}`,
    revisionId: REV_2_ID,
    gates: ["test_suite", "physical_hil"],
    loopReturn: {
      id: "5eed003e-0000-4000-8000-000000000001",
      revisionId: REV_2_ID,
      controlId,
      gateKeys: ["test_suite", "physical_hil"],
      expected: { stageKey: "implement", attempt: 5 },
      requestedBy: KEN.id,
      createdAt: "2026-09-27T14:41:00.000Z",
    },
    skipped: [],
    ...over,
  };
}

/**
 * One row of the listing.
 *
 * @param over What to change.
 * @returns PR #514's row, changed.
 */
export function summary(over: Partial<PullRequestSummary> = {}): PullRequestSummary {
  return {
    ...prHeadOf(),
    latestRevision: {
      id: REV_2_ID,
      seq: 2,
      headSha: "b7e41d0",
      pushedAt: "2026-09-27T14:30:00.000Z",
    },
    gates: null,
    reviewRequested: false,
    ...over,
  };
}

/** The correction note that bridged Revision 1 to Revision 2 — mockup 12's. */
export const CORRECTION_NOTE = "PID sampling moved off telemetry path";

/** Build 3 — the attempt Revision 1 was judged on. */
export const ATTEMPT_3_ID = "5eed0031-0000-4000-8000-000000004823";

/** Build 4 — the attempt Revision 2 was judged on. */
export const ATTEMPT_4_ID = "5eed0031-0000-4000-8000-000000004824";

/**
 * The classification that bridged the two revisions (#332).
 *
 * @param over What to change.
 * @returns A product bug a model classified on Build 3, with the correction note, changed.
 */
export function classification(
  over: Partial<NonNullable<NonNullable<PrRevision["correction"]>["classification"]>> = {},
): NonNullable<NonNullable<PrRevision["correction"]>["classification"]> {
  return {
    id: "5eed0042-0000-4000-8000-000000000001",
    testRunId: ATTEMPT_3_ID,
    class: "product_bug",
    subtype: null,
    note: CORRECTION_NOTE,
    actor: "model",
    createdAt: "2026-09-27T14:20:00.000Z",
    ...over,
  };
}

/**
 * Revision 1 as the strip reads it (#364): pushed at 14:10, judged on Build 3, the test suite and
 * the physical HIL gates red.
 *
 * @param over What to change.
 * @returns The revision.
 */
export function revisionOne(over: Partial<PrRevision> = {}): PrRevision {
  return revision({
    id: REV_1_ID,
    seq: 1,
    headSha: "3f9c2ae",
    pushedAt: "2026-09-27T14:10:00.000Z",
    testAttempt: { id: ATTEMPT_3_ID, attemptSeq: 3 },
    gates: {
      revisionId: REV_1_ID,
      aggregate: {
        requiredCount: 7,
        greenCount: 3,
        redCount: 2,
        satisfiedCount: 4,
        mergeReady: false,
      },
      rows: gateRows({ test_suite: ["red", TESTS_RED], physical_hil: ["red", HIL_RED] }),
    },
    ...over,
  });
}

/**
 * Revision 2 as the strip reads it (#364): pushed at 14:31 after the correction round, judged on
 * Build 4, five of seven gates green.
 *
 * @param over What to change.
 * @returns The revision.
 */
export function revisionTwo(over: Partial<PrRevision> = {}): PrRevision {
  return revision({
    pushedAt: "2026-09-27T14:31:00.000Z",
    testAttempt: { id: ATTEMPT_4_ID, attemptSeq: 4 },
    gates: {
      revisionId: REV_2_ID,
      aggregate: {
        requiredCount: 7,
        greenCount: 5,
        redCount: 0,
        satisfiedCount: 6,
        mergeReady: false,
      },
      rows: gateRows(),
    },
    correction: {
      fromRevisionId: REV_1_ID,
      classification: classification(),
      loopReturn: null,
    },
    ...over,
  });
}

/**
 * The page with mockup 12's revision cycle (#364): Revision 1 blocked, the correction round,
 * Revision 2 live, and the merge plan unarmed.
 *
 * @param over What else to change.
 * @returns The page.
 */
export function stripPage(over: Parameters<typeof prPage>[0] = {}): PullRequestPage {
  return prPage({ revisions: [revisionOne(), revisionTwo()], ...over });
}
