import type {
  CriteriaMatrix,
  PrCriterion,
  PrEvidence,
  PrFiles,
  PrGateRow,
  PrMergeOutcome,
  PrMergePlan,
  PrReview,
  PrRevision,
  PrSpend,
  PrThread,
  PrThreadEntry,
  PrThreadResolution,
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

/**
 * When the helper's PR was last synced: as the suite loaded, so a case that is not about the
 * sync-lag banner (#370) never draws it, and one instant for the whole file, so two pages made
 * apart are still equal. The seed's own #514 has never been synced — `syncedAt: null`.
 */
export const JUST_SYNCED = new Date().toISOString();

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
    syncedAt: JUST_SYNCED,
    ...over,
  };
}

/** The seeded message — the PR's title, and the trailer that closes its ticket. */
export const SEEDED_MESSAGE = "can: fix flaky telemetry frame order under ISR load\n\nCloses #482.";

/** The roadmap's *OTA hardening* epic, and the one below it. */
export const OTA_EPIC = { id: "5eed001f-0000-4000-8000-000000000001", name: "OTA hardening" };
export const BLE_EPIC = { id: "5eed001f-0000-4000-8000-000000000002", name: "BLE provisioning v2" };

/**
 * The merge plan (#369).
 *
 * @param over What to change.
 * @returns PR #514's plan as the seed leaves it — squash and delete the branch, close #482,
 *   comment the evidence, leave the roadmap alone, unarmed — changed.
 */
export function mergePlan(over: Partial<PrMergePlan> = {}): PrMergePlan {
  return {
    prId: PR_514_ID,
    strategy: "squash",
    deleteBranch: true,
    commitMessage: SEEDED_MESSAGE,
    closeTicket: true,
    commentEvidence: true,
    backAnnotateEpic: false,
    epicId: null,
    armed: false,
    armedBy: null,
    armedByPerson: null,
    armedAt: null,
    armedAgainstRevisionId: null,
    disarmReason: null,
    mergedResult: null,
    dryRun: DRY_RUN_OFF,
    updatedAt: "2026-09-27T14:32:00.000Z",
    ...over,
  };
}

/** The dry-run policy off, and no auto-merge terminal (#382). */
export const DRY_RUN_OFF: PrMergePlan["dryRun"] = {
  active: false,
  reason: null,
  autoMerge: { requested: false, effective: false, overridden: false },
};

/**
 * The dry-run policy on (#382).
 *
 * @param autoMerges Whether the pinned workflow's terminal asks for auto-merge — then overridden.
 * @returns The plan's dry-run state.
 */
export function dryRunOn(autoMerges = false): PrMergePlan["dryRun"] {
  return {
    active: true,
    reason: "dry-run policy active",
    autoMerge: { requested: autoMerges, effective: false, overridden: autoMerges },
  };
}

/**
 * The plan, armed by Ken against Revision 2.
 *
 * @param over What else to change.
 * @returns The armed plan.
 */
export function armedPlan(over: Partial<PrMergePlan> = {}): PrMergePlan {
  return mergePlan({
    armed: true,
    armedBy: KEN.id,
    armedByPerson: KEN,
    armedAt: "2026-09-27T14:40:12.000Z",
    armedAgainstRevisionId: REV_2_ID,
    updatedAt: "2026-09-27T14:40:12.000Z",
    ...over,
  });
}

/**
 * The plan, merged: what landed, as whom, and what ran.
 *
 * @param over What else to change.
 * @returns The merged plan.
 */
export function mergedPlan(over: Partial<PrMergePlan> = {}): PrMergePlan {
  return mergePlan({
    mergedResult: {
      sha: "9c4ab7f02d31",
      identityUsed: "ken-s",
      actionsExecuted: ["close_ticket", "comment_evidence", "delete_branch"],
      mergedAt: "2026-09-27T14:45:02.000Z",
    },
    updatedAt: "2026-09-27T14:45:02.000Z",
    ...over,
  });
}

/**
 * What *Merge now* answers.
 *
 * @param over What to change.
 * @returns A merge that closed the ticket and ran everything switched on, changed.
 */
export function mergeOutcome(over: Partial<PrMergeOutcome> = {}): PrMergeOutcome {
  return {
    plan: mergedPlan(),
    ticket: { key: "#482", closed: true, detail: null },
    failedActions: [],
    ...over,
  };
}

/**
 * The spend rollup (#369) — the seed's figures: `284k tokens · $1.52`, `41k · $0.19`, within the
 * `implement-primary` route's `$2.50` cap, nothing unpriced.
 *
 * @param over What to change.
 * @returns The rollup, changed.
 */
export function seededSpend(over: Partial<PrSpend> = {}): PrSpend {
  return {
    loop: {
      tokens: 284_000,
      tokensIn: 227_200,
      tokensOut: 56_800,
      costCents: "152.0000",
      unpricedEvents: 0,
    },
    verification: {
      tokens: 41_000,
      tokensIn: 32_800,
      tokensOut: 8_200,
      costCents: "19.0000",
      unpricedEvents: 0,
    },
    verificationTag: "verify",
    cap: { cents: 250, routeTag: "implement-primary" },
    withinCap: true,
    ...over,
  };
}

/**
 * The page with every required gate green — what *Merge now* is offered on.
 *
 * @param over What else to change.
 * @returns The page, ready to merge.
 */
export function readyPage(over: Parameters<typeof prPage>[0] = {}): PullRequestPage {
  return prPage({
    gates: {
      revisionId: REV_2_ID,
      aggregate: {
        requiredCount: 7,
        greenCount: 6,
        redCount: 0,
        satisfiedCount: 7,
        mergeReady: true,
      },
      rows: gateRows({ model_review: ["green", "cursor/composer-2 · approved"] }),
    },
    ...over,
  });
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
      planContext: false,
      counts: { total: 0, verified: 0, waived: 0, unverified: 0 },
      criteria: [],
    },
    files: null,
    thread: { entryCount: 0, openCount: 0, entries: [] },
    plan: mergePlan(),
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

/** The sentence the service records when a gate went red under an armed plan. */
export const GATE_RED_MESSAGE = "Physical HIL is red on revision 2.";

/** The sentence the service records when the host reports a conflict. */
export const HOST_CONFLICT_MESSAGE = "The host reports a merge conflict with the base branch.";

/**
 * The page once the plan merged the PR (#370): the host's mirror has caught up, every required
 * gate stands green, and the plan holds the receipt.
 *
 * @param over What else to change.
 * @returns The merged page.
 */
export function mergedPage(over: Parameters<typeof prPage>[0] = {}): PullRequestPage {
  return readyPage({
    plan: mergedPlan(),
    ...over,
    pullRequest: {
      state: "merged",
      mergedAt: "2026-09-27T14:45:02.000Z",
      mergedBy: "ken-s",
      ...over.pullRequest,
    },
  });
}

/**
 * The page of a PR its host closed without merging (#370).
 *
 * @param over What else to change.
 * @returns The closed page.
 */
export function closedPage(over: Parameters<typeof prPage>[0] = {}): PullRequestPage {
  return prPage({ ...over, pullRequest: { state: "closed", ...over.pullRequest } });
}

/**
 * The page after a re-check disarmed the plan (#370) — the host reported a conflict, so the PR
 * is back to `verifying` and the plan says why.
 *
 * @param over What else to change.
 * @returns The disarmed page.
 */
export function disarmedPage(over: Parameters<typeof prPage>[0] = {}): PullRequestPage {
  return prPage({
    plan: mergePlan({
      disarmReason: { code: "host_conflict", message: HOST_CONFLICT_MESSAGE },
      updatedAt: "2026-09-27T14:41:30.000Z",
    }),
    ...over,
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

// --- the acceptance criteria matrix (#366) -------------------------------------------------

/** The host comment the waive of the thermal claim posted. */
export const WAIVE_COMMENT_URL = `${HOST_URL}#issuecomment-5140001`;

/** Why the thermal claim was waived — mockup 12's. */
export const THERMAL_REASON = "rig runs at 22°C only — thermal chamber not in bench";

/** The file the mockup's hunk is in. */
export const TELEMETRY_PATH = "drivers/can/telemetry_buf.c";

/** The frame-order test case cited by the first claim — a row of Build 4. */
export const CITED_CASE_ID = "5eed0035-0000-4000-8000-000000048201";

/** The overshoot measurement cited by the second claim. */
export const CITED_MEASUREMENT_ID = "5eed0036-0000-4000-8000-000000048201";

/**
 * A claim's id.
 *
 * @param n Its ordinal in the matrix, from 1.
 * @returns The uuid.
 */
export function criterionId(n: number): string {
  return `5eed0050-0000-4000-8000-00000000000${n}`;
}

/**
 * A citation's id.
 *
 * @param n Its ordinal among the seed's citations, from 1.
 * @returns The uuid.
 */
export function evidenceId(n: number): string {
  return `5eed0051-0000-4000-8000-00000000000${n}`;
}

/**
 * One citation.
 *
 * @param over What to change: its fields, and any part of its reference.
 * @returns An analysis note read on Revision 2, changed.
 */
export function evidence(
  over: Partial<Omit<PrEvidence, "ref">> & { readonly ref?: Partial<PrEvidence["ref"]> } = {},
): PrEvidence {
  const { ref, ...fields } = over;

  return {
    id: evidenceId(1),
    criterionId: criterionId(1),
    kind: "analysis_note",
    displayText: "test asserts on seq gaps, not sleep-based",
    createdAt: "2026-09-27T14:35:00.000Z",
    ...fields,
    ref: {
      testCaseId: null,
      hilMeasurementId: null,
      testArtifactId: null,
      revisionId: null,
      path: null,
      lineStart: null,
      lineEnd: null,
      ...ref,
    },
  };
}

/**
 * One claim.
 *
 * @param over What to change.
 * @returns A manual claim nobody has cited evidence for, changed.
 */
export function criterion(over: Partial<PrCriterion> = {}): PrCriterion {
  return {
    id: criterionId(1),
    prId: PR_514_ID,
    claim: "Telemetry frames must arrive in ISR order under load",
    source: "manual",
    status: "unverified",
    sortOrder: 1,
    createdBy: KEN.id,
    createdAt: "2026-09-27T14:33:00.000Z",
    updatedAt: "2026-09-27T14:33:00.000Z",
    evidence: [],
    waiver: null,
    ...over,
  };
}

/**
 * A waiver.
 *
 * @param over What to change about its annotation.
 * @returns The thermal waiver, annotated on the host, changed.
 */
export function waiver(
  over: Partial<NonNullable<PrCriterion["waiver"]>["annotation"]> = {},
): NonNullable<PrCriterion["waiver"]> {
  return {
    id: "5eed0052-0000-4000-8000-000000000001",
    reason: THERMAL_REASON,
    author: KEN.name,
    createdAt: "2026-09-27T14:45:00.000Z",
    annotation: {
      state: "annotated",
      commentId: "5140001",
      url: WAIVE_COMMENT_URL,
      annotatedAt: "2026-09-27T14:45:01.000Z",
      ...over,
    },
  };
}

/**
 * Mockup 12's five claims: four verified — by a test and a hunk, a measurement, and two analysis
 * notes — and the thermal claim waived and annotated on the PR.
 *
 * @returns The claims, in the matrix's order.
 */
export function mockupCriteria(): PrCriterion[] {
  return [
    criterion({
      status: "verified",
      source: "plan",
      evidence: [
        evidence({
          kind: "test_case",
          displayText: "test_frame_order_under_load (10⁶ frames, 0 reordered)",
          ref: { testCaseId: CITED_CASE_ID },
        }),
        evidence({
          id: evidenceId(2),
          kind: "hunk",
          displayText: "hunk telemetry_buf.c:41–66",
          ref: { revisionId: REV_2_ID, path: TELEMETRY_PATH, lineStart: 41, lineEnd: 66 },
        }),
      ],
    }),
    criterion({
      id: criterionId(2),
      claim: "No regression in e-stop response envelope",
      status: "verified",
      source: "plan",
      sortOrder: 2,
      evidence: [
        evidence({
          id: evidenceId(3),
          criterionId: criterionId(2),
          kind: "hil_measurement",
          displayText: "HIL overshoot 1.7% vs 2.0% limit (was 2.4% in rev 1)",
          ref: { hilMeasurementId: CITED_MEASUREMENT_ID },
        }),
      ],
    }),
    criterion({
      id: criterionId(3),
      claim: "Fix must not mask real ordering bugs in tests",
      status: "verified",
      sortOrder: 3,
      evidence: [
        evidence({
          id: evidenceId(4),
          criterionId: criterionId(3),
          ref: { revisionId: REV_2_ID },
        }),
      ],
    }),
    criterion({
      id: criterionId(4),
      claim: "Zero heap allocation in ISR fast path",
      status: "verified",
      sortOrder: 4,
      evidence: [
        evidence({
          id: evidenceId(5),
          criterionId: criterionId(4),
          displayText: "static K_MSGQ_DEFINE · stack analysis clean",
          ref: { revisionId: REV_2_ID },
        }),
      ],
    }),
    criterion({
      id: criterionId(5),
      claim: "Flake must not reappear across temperature range",
      status: "waived",
      sortOrder: 5,
      waiver: waiver(),
    }),
  ];
}

/**
 * A matrix.
 *
 * @param criteria Its claims. Defaults to mockup 12's.
 * @param planContext Whether there is a plan to import from. Defaults to none.
 * @returns The matrix, its counts taken from the claims.
 */
export function matrix(
  criteria: readonly PrCriterion[] = mockupCriteria(),
  planContext = false,
): CriteriaMatrix {
  const count = (status: PrCriterion["status"]): number =>
    criteria.filter((each) => each.status === status).length;

  return {
    prId: PR_514_ID,
    planContext,
    counts: {
      total: criteria.length,
      verified: count("verified"),
      waived: count("waived"),
      unverified: count("unverified"),
    },
    criteria: [...criteria],
  };
}

/**
 * The latest revision's files snapshot — mockup 12's `+68 −15 · 3 files`.
 *
 * @param over What to change.
 * @returns The snapshot, changed.
 */
export function files(over: Partial<PrFiles> = {}): PrFiles {
  return {
    revisionId: REV_2_ID,
    additions: 68,
    deletions: 15,
    rows: [
      { path: TELEMETRY_PATH, additions: 38, deletions: 12 },
      { path: "drivers/can/telemetry_buf.h", additions: 6, deletions: 1 },
      { path: "tests/integration/test_telemetry.c", additions: 24, deletions: 2 },
    ],
    diffExcerpt: null,
    fullDiffUrl: `${HOST_URL}/files`,
    ...over,
  };
}

// --- the changed files card (#367) ---------------------------------------------------------

/** The file the diff-vs-plan fixture flags. */
export const ISR_PATH = "drivers/can/isr_fastpath.c";

/** The test the mockup's change adds. */
export const FRAME_ORDER_PATH = "tests/telemetry/test_frame_order.c";

/** Mockup 12's diff sample, as the dev seed stores it — a header naming the path and the line. */
export const MOCKUP_EXCERPT = [
  `@@ ${TELEMETRY_PATH}:41 @@ static void can_isr_rx(const struct device *dev)`,
  "     struct tlm_frame *slot = tlm_slot_claim();",
  "-    slot->ts = k_cycle_get_32();",
  "-    k_fifo_put(&telemetry_fifo, slot);",
  "+    slot->ts  = k_cycle_get_32();",
  "+    slot->seq = (uint16_t)atomic_inc(&tlm_seq);   /* ISR-ordered */",
  "+    k_msgq_put(&telemetry_msgq, slot, K_NO_WAIT);",
  "",
].join("\n");

/** A sample in the host sync's shape (`diffExcerptOf`, #352) — two of the three files. */
export const HOST_EXCERPT = [
  `--- ${TELEMETRY_PATH}`,
  "@@ -41,3 +41,4 @@ static void can_isr_rx(const struct device *dev)",
  "     struct tlm_frame *slot = tlm_slot_claim();",
  "-    k_fifo_put(&telemetry_fifo, slot);",
  "+    slot->seq = (uint16_t)atomic_inc(&tlm_seq);",
  "+    k_msgq_put(&telemetry_msgq, slot, K_NO_WAIT);",
  " }",
  `--- ${ISR_PATH}`,
  "@@ -7 +7,2 @@",
  "-#define FAST 0",
  "+#define FAST 1",
  "+#define ORDERED 1",
].join("\n");

/**
 * Mockup 12's Changed files card — `+68 −15`, its three rows and its excerpt.
 *
 * @param over What to change.
 * @returns The snapshot, changed.
 */
export function mockupFiles(over: Partial<PrFiles> = {}): PrFiles {
  return files({
    rows: [
      { path: TELEMETRY_PATH, additions: 38, deletions: 12 },
      { path: ISR_PATH, additions: 9, deletions: 3 },
      { path: FRAME_ORDER_PATH, additions: 21, deletions: 0 },
    ],
    diffExcerpt: MOCKUP_EXCERPT,
    ...over,
  });
}

/**
 * The page with mockup 12's changed files (#367).
 *
 * @param over What else to change.
 * @returns The page.
 */
export function filesPage(over: Parameters<typeof prPage>[0] = {}): PullRequestPage {
  return matrixPage({ files: mockupFiles(), ...over });
}

/**
 * The page with diff-vs-plan red on the latest revision (#358), naming what it flags.
 *
 * @param evidence The gate's line.
 * @param over What else to change.
 * @returns The page.
 */
export function outOfScopePage(
  evidence: string | null = `1 out-of-scope edit: ${ISR_PATH}`,
  over: Parameters<typeof prPage>[0] = {},
): PullRequestPage {
  const rows = gateRows({ diff_vs_plan: ["red", evidence] });

  return filesPage({
    revisions: [revisionOne(), { ...revisionTwo(), gates: { ...revisionTwo().gates, rows } }],
    gates: { revisionId: REV_2_ID, aggregate: null, rows },
    ...over,
  });
}

/**
 * The page with mockup 12's matrix (#366): the revision cycle, the five claims and the files
 * snapshot.
 *
 * @param over What else to change.
 * @returns The page.
 */
export function matrixPage(over: Parameters<typeof prPage>[0] = {}): PullRequestPage {
  return stripPage({ criteria: matrix(), files: files(), ...over });
}

/** The reply that resolved the mockup's second opinion. */
export const ATTEMPT_4_REPLY = "Addressed in attempt 4 — sampling decoupled from telemetry drain.";

/** The policy bot's rule text. */
export const POLICY_RULE =
  "Auto-merge eligible: standard-fix policy — no human review required for effort ≤ M with all gates green.";

/** Where a mirrored reply landed on the host. */
export const MIRROR_COMMENT_URL = `${HOST_URL}#issuecomment-5140002`;

/**
 * A thread entry's id.
 *
 * @param n Its ordinal.
 * @returns The seed's id for it.
 */
export function threadEntryId(n: number): string {
  return `5eed0040-0000-4000-8000-${String(5140 + n).padStart(12, "0")}`;
}

/**
 * One entry of the review thread (#368).
 *
 * @param over What to change.
 * @returns An open, blocking objection a person wrote about Revision 2, changed.
 */
export function threadEntry(over: Partial<PrThreadEntry> = {}): PrThreadEntry {
  return {
    id: threadEntryId(4),
    revisionId: REV_2_ID,
    revisionSeq: 2,
    authorKind: "human",
    authorName: "Priya N",
    tag: "second opinion",
    body: "The drain loop still allocates on overflow.",
    blocking: true,
    resolved: false,
    resolutionBody: null,
    simulated: false,
    createdAt: "2026-09-27T14:33:10.000Z",
    ...over,
  };
}

/**
 * Mockup 12's three entries, oldest first as the payload states them: the second opinion on
 * Revision 1 that blocked and was resolved, the self-review, and the policy bot's rule. Both
 * model entries carry the watermark.
 *
 * @returns The entries.
 */
export function mockupEntries(): PrThreadEntry[] {
  return [
    threadEntry({
      id: threadEntryId(2),
      revisionId: REV_1_ID,
      revisionSeq: 1,
      authorKind: "model",
      authorName: "cursor/composer-2",
      tag: "second opinion",
      body: "PID velocity sample now lags by one telemetry period — measurable overshoot risk on hard e-stop.",
      blocking: true,
      resolved: true,
      resolutionBody: ATTEMPT_4_REPLY,
      simulated: true,
      createdAt: "2026-09-27T14:12:44.000Z",
    }),
    threadEntry({
      id: threadEntryId(1),
      revisionId: null,
      revisionSeq: null,
      authorKind: "model",
      authorName: "claude-fable-5",
      tag: "self-review",
      body: "ISR path is allocation-free; verified priority ceiling unchanged. Sequence counter wraps at 65535 with gap-tolerant comparison in the drain loop.",
      blocking: false,
      resolved: true,
      simulated: true,
      createdAt: "2026-09-27T14:29:07.000Z",
    }),
    threadEntry({
      id: threadEntryId(3),
      authorKind: "policy_bot",
      authorName: "ouroboros policy bot",
      tag: "policy",
      body: POLICY_RULE,
      blocking: false,
      createdAt: "2026-09-27T14:31:52.000Z",
    }),
  ];
}

/**
 * A thread.
 *
 * @param entries Its entries. Defaults to the mockup's.
 * @param counts The payload's own counts — which the card does not read. Defaults to the truth.
 * @returns The thread.
 */
export function thread(
  entries: readonly PrThreadEntry[] = mockupEntries(),
  counts: Partial<Pick<PrThread, "entryCount" | "openCount">> = {},
): PrThread {
  return {
    entryCount: entries.length,
    openCount: entries.filter((entry) => entry.blocking && !entry.resolved).length,
    entries: [...entries],
    ...counts,
  };
}

/**
 * The page with a review thread (#368) over the revision cycle.
 *
 * @param entries The thread's entries. Defaults to the mockup's.
 * @param over What else to change.
 * @returns The page.
 */
export function threadPage(
  entries: readonly PrThreadEntry[] = mockupEntries(),
  over: Parameters<typeof prPage>[0] = {},
): PullRequestPage {
  return stripPage({ thread: thread(entries), ...over });
}

/**
 * What *Reply & resolve* answers.
 *
 * @param entry The entry as it was before.
 * @param reply The resolving reply, or `null`.
 * @param mirror How the mirror landed. Defaults to not requested.
 * @returns The resolution.
 */
export function resolution(
  entry: PrThreadEntry,
  reply: string | null,
  mirror: PrThreadResolution["mirror"] = { state: "not_requested", url: null, error: null },
): PrThreadResolution {
  return { entry: { ...entry, resolved: true, resolutionBody: reply }, mirror };
}
