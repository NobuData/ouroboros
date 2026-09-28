/**
 * An in-memory {@link PageStore} holding mockup 12's PR #514 — for the page's unit and contract
 * suites (AX.5, [#361](https://github.com/NobuData/ouroboros/issues/361)). The statements themselves
 * are proven against a migrated database; this is the universe the service logic is judged over.
 *
 * ```
 * PR #514 · verifying · loop #1847 · issue #482 · +68 −15 · 3 files
 * Revision 1 (3f9c2ae) — attempt 3 — build ✓ tests ✗ 61/63 HIL ✗ 2.4% … — 2 red
 * Revision 2 (b7e41d0) — attempt 4 — five green, model review unavailable, human not_required
 * thread: 3 entries · 0 open      spend: 284k · $1.52, verify 41k · $0.19, cap $2.50
 * ```
 */

import type { PrApprovalHostRequest, PrApprovalState } from "../../db/schema";
import type { SpendTotals } from "../../runs/run.spend";
import type { PageWindow } from "../../tenancy/pagination";
import { aggregate, type GateAggregate } from "../gates/gate.engine";
import type {
  ApprovalRow,
  ClassificationRow,
  GateRowRecord,
  LockedPr,
  LoopReturnRow,
  NewLoopReturn,
  PageStore,
  PageTransaction,
  PrHeadRow,
  PrListFilter,
  PrListRow,
  PrRunRow,
  RevisionRow,
  TestAttemptRow,
  ThreadRows,
} from "./page.repository";
import type { RouteCapRow } from "./page.spend";

export const ORG = "org-acme";
export const OTHER_ORG = "org-other";
export const PR = "5eed003a-0000-4000-8000-000000000514";
export const RUN = "5eed0009-0000-4000-8000-000000000482";
export const REV_1 = "5eed003b-0000-4000-8000-000000005141";
export const REV_2 = "5eed003b-0000-4000-8000-000000005142";
export const ATTEMPT_3 = "5eed0031-0000-4000-8000-000000004823";
export const ATTEMPT_4 = "5eed0031-0000-4000-8000-000000004824";
export const KEN = { id: "5eed0003-0000-4000-8000-000000000001", name: "Ken S" };

const T0 = new Date("2026-09-27T14:00:00.000Z");

/**
 * A uuid-shaped id for a row the fake mints, so the contract suite's `format: uuid` holds.
 *
 * @param prefix - One byte naming the table.
 * @param n - The row's ordinal.
 * @returns `5eedXX00-0000-4000-8000-<n>`.
 */
function uuidOf(prefix: number, n: number): string {
  return `5eed${prefix.toString(16).padStart(2, "0")}00-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

/**
 * @param minutes - Minutes after 14:00.
 * @returns The instant.
 */
function at(minutes: number): Date {
  return new Date(T0.getTime() + minutes * 60_000);
}

/** The loop. */
export const RUN_ROW: PrRunRow = {
  id: RUN,
  loopSeq: 1847,
  issueNumber: 482,
  model: "claude-fable-5",
  workflowTag: "standard-fix",
  workflowVersionPin: 14,
  status: "coding",
  finishedAt: null,
};

/** The head. */
export const HEAD: PrHeadRow = {
  id: PR,
  sourceId: "5eed0020-0000-4000-8000-000000000001",
  number: 514,
  url: "https://github.com/acme-robotics/helios-firmware/pull/514",
  title: "can: fix flaky telemetry frame order under ISR load",
  headBranch: "loop/482-canbus-flake",
  baseBranch: "main",
  additions: 68,
  deletions: 15,
  changedFiles: 3,
  state: "verifying",
  mergedAt: null,
  mergedBy: null,
  createdAt: at(10),
  updatedAt: at(32),
  run: RUN_ROW,
  ticket: {
    id: "5eed0030-0000-4000-8000-000000000482",
    key: "#482",
    title: "Fix flaky CAN-bus telemetry test",
    url: "https://github.com/acme-robotics/helios-firmware/issues/482",
  },
};

const FILES = [
  { path: "drivers/can/telemetry_buf.c", additions: 38, deletions: 12 },
  { path: "drivers/can/isr_fastpath.c", additions: 9, deletions: 3 },
  { path: "tests/telemetry/test_frame_order.c", additions: 21, deletions: 0 },
];

/** The two revisions. */
export function revisions(): RevisionRow[] {
  return [
    {
      id: REV_1,
      seq: 1,
      headSha: "3f9c2ae",
      pushedAt: at(10),
      files: FILES,
      diffExcerpt: null,
      stageAttempt: null,
      commitMessage: null,
    },
    {
      id: REV_2,
      seq: 2,
      headSha: "b7e41d0",
      pushedAt: at(31),
      files: FILES,
      diffExcerpt:
        "@@ drivers/can/telemetry_buf.c:41 @@ static void can_isr_rx(const struct device *dev)",
      stageAttempt: null,
      commitMessage: null,
    },
  ];
}

/**
 * One gate row.
 *
 * @param revisionId - The revision.
 * @param sortOrder - The card position.
 * @param key - The gate.
 * @param verdict - Its verdict.
 * @param evidence - Its line.
 * @param evidenceRef - Its link.
 * @returns The row.
 */
function gate(
  revisionId: string,
  sortOrder: number,
  key: GateRowRecord["key"],
  verdict: GateRowRecord["verdict"],
  evidence: string,
  evidenceRef: GateRowRecord["evidenceRef"] = null,
): GateRowRecord {
  const labels: Record<string, string> = {
    build: "Build",
    test_suite: "Test suite",
    physical_hil: "Physical HIL",
    diff_vs_plan: "Diff-vs-plan conformance",
    secrets_license: "Secrets & license scan",
    model_review: "Second-model review",
    human_approval: "Human approval",
  };

  return {
    revisionId,
    key,
    label: labels[key] ?? key,
    required: true,
    sortOrder,
    source: "standard-fix@v14 pin",
    verdict,
    evidence,
    evidenceRef,
    evaluatedAt: revisionId === REV_1 ? at(12) : at(31),
    providerVersion: "gate-test@1.0.0",
  };
}

/** Both revisions' snapshots, as `pr_gate_results_latest` holds them. */
export function gateRows(): GateRowRecord[] {
  return [
    gate(REV_1, 1, "build", "green", "forge-01 · zephyr.elf · FLASH 43.5%"),
    gate(REV_1, 2, "test_suite", "red", "61/63 after attempt 3", {
      kind: "test_run",
      id: ATTEMPT_3,
    }),
    gate(REV_1, 3, "physical_hil", "red", "overshoot 2.4% > 2.0% · rig helios-rig-02"),
    gate(
      REV_1,
      4,
      "diff_vs_plan",
      "green",
      "all hunks map to planned files · 0 out-of-scope edits",
    ),
    gate(REV_1, 5, "secrets_license", "green", "clean"),
    gate(REV_1, 6, "model_review", "unavailable", "no second-model review provider until AZ.1"),
    gate(REV_1, 7, "human_approval", "not_required", "not required by policy"),
    gate(REV_2, 1, "build", "green", "forge-01 · zephyr.elf · FLASH 43.5%"),
    gate(REV_2, 2, "test_suite", "green", "63/63 after attempt 4", {
      kind: "test_run",
      id: ATTEMPT_4,
    }),
    gate(REV_2, 3, "physical_hil", "green", "overshoot 1.7% ≤ 2.0% · rig helios-rig-02"),
    gate(
      REV_2,
      4,
      "diff_vs_plan",
      "green",
      "all hunks map to planned files · 0 out-of-scope edits",
    ),
    gate(REV_2, 5, "secrets_license", "green", "clean"),
    gate(REV_2, 6, "model_review", "unavailable", "no second-model review provider until AZ.1"),
    gate(REV_2, 7, "human_approval", "not_required", "not required by policy"),
  ];
}

/** The review thread. */
export function thread(): ThreadRows {
  return {
    entryCount: 3,
    openCount: 0,
    entries: [
      {
        id: "5eed0040-0000-4000-8000-000000005142",
        revisionId: REV_1,
        revisionSeq: 1,
        authorKind: "model",
        authorName: "cursor/composer-2",
        tag: "second opinion",
        body: "PID velocity sample now lags by one telemetry period — measurable overshoot risk on hard e-stop.",
        blocking: true,
        resolved: true,
        resolutionBody: "Addressed in attempt 4 — sampling decoupled from telemetry drain.",
        simulated: true,
        createdAt: at(12),
      },
      {
        id: "5eed0040-0000-4000-8000-000000005141",
        revisionId: null,
        revisionSeq: null,
        authorKind: "model",
        authorName: "claude-fable-5",
        tag: "self-review",
        body: "ISR path is allocation-free; verified priority ceiling unchanged.",
        blocking: false,
        resolved: true,
        resolutionBody: null,
        simulated: true,
        createdAt: at(29),
      },
      {
        id: "5eed0040-0000-4000-8000-000000005143",
        revisionId: REV_2,
        revisionSeq: 2,
        authorKind: "policy_bot",
        authorName: "ouroboros policy bot",
        tag: "policy",
        body: "Auto-merge eligible: standard-fix policy — no human review required for effort ≤ M with all gates green.",
        blocking: false,
        resolved: false,
        resolutionBody: null,
        simulated: false,
        createdAt: at(31),
      },
    ],
  };
}

/**
 * A ledger sum.
 *
 * @param tokens - Tokens, split 4/5 in and 1/5 out as the seed does.
 * @param costCents - The cost, or null when unpriced.
 * @param unpriced - Unpriced rows.
 * @returns The totals.
 */
export function totals(tokens: number, costCents: string | null, unpriced = 0): SpendTotals {
  return { tokensIn: (tokens / 5) * 4, tokensOut: tokens / 5, costCents, unpricedEvents: unpriced };
}

/** A stored approval slot. */
interface StoredApproval extends ApprovalRow {
  readonly prId: string;
}

/** The fake store — every answer read off the arrays below, which a case may edit. */
export class FakePageStore implements PageStore {
  head514: PrHeadRow = HEAD;
  revisionRows: RevisionRow[] = revisions();
  gates: GateRowRecord[] = gateRows();
  threadRows: ThreadRows = thread();
  approvals: StoredApproval[] = [];
  returns: LoopReturnRow[] = [];
  attempts = new Map<string, TestAttemptRow>([
    [ATTEMPT_3, { id: ATTEMPT_3, attemptSeq: 3 }],
    [ATTEMPT_4, { id: ATTEMPT_4, attemptSeq: 4 }],
  ]);
  classificationRows: ClassificationRow[] = [
    {
      id: "5eed0037-0000-4000-8000-000000000482",
      testRunId: ATTEMPT_3,
      class: "product_bug",
      subtype: null,
      note: null,
      actor: "heuristic",
      createdAt: at(13),
    },
  ];
  ledger = { loop: totals(284_000, "152.0000"), verification: totals(41_000, "19.0000") };
  route: RouteCapRow | undefined = { tag: "implement-primary", maxCostCentsPerRun: 250 };
  stage: { stageKey: string; attempt: number } | undefined = { stageKey: "implement", attempt: 3 };
  /** Host request updates, in order. */
  readonly hostRequests: {
    approvalId: string;
    outcome: PrApprovalHostRequest;
    detail: string | null;
  }[] = [];
  private sequence = 0;

  /** @inheritdoc */
  list(
    organizationId: string,
    filter: PrListFilter,
    window: PageWindow,
  ): Promise<{ rows: PrListRow[]; total: number }> {
    const open = this.approvals.some((row) => row.prId === PR && row.state === "requested");
    const all: PrListRow[] =
      organizationId === ORG
        ? [
            {
              ...this.head514,
              latestRevision: this.revisionRows.at(-1) ?? null,
              reviewRequested: open,
            },
          ]
        : [];
    const rows = all
      .filter((row) => filter.states === undefined || filter.states.includes(row.state))
      .filter(
        (row) =>
          filter.reviewRequested === undefined || row.reviewRequested === filter.reviewRequested,
      );

    return Promise.resolve({
      rows: rows.slice(window.offset, window.offset + window.limit),
      total: rows.length,
    });
  }

  /** @inheritdoc */
  head(organizationId: string, prId: string): Promise<PrHeadRow | undefined> {
    return Promise.resolve(organizationId === ORG && prId === PR ? this.head514 : undefined);
  }

  /** @inheritdoc */
  revisions(): Promise<RevisionRow[]> {
    return Promise.resolve(this.revisionRows);
  }

  /** @inheritdoc */
  gateRows(): Promise<GateRowRecord[]> {
    return Promise.resolve(this.gates);
  }

  /** @inheritdoc */
  aggregates(revisionIds: readonly string[]): Promise<Map<string, GateAggregate>> {
    return Promise.resolve(
      new Map(
        revisionIds.map((id) => [
          id,
          aggregate(
            this.gates
              .filter((row) => row.revisionId === id)
              .map((row) => ({ required: row.required, verdict: row.verdict })),
          ),
        ]),
      ),
    );
  }

  /** @inheritdoc */
  testAttempts(
    organizationId: string,
    ids: readonly string[],
  ): Promise<Map<string, TestAttemptRow>> {
    return Promise.resolve(
      new Map(
        organizationId === ORG
          ? ids.flatMap((id) => {
              const row = this.attempts.get(id);
              return row === undefined ? [] : [[id, row] as const];
            })
          : [],
      ),
    );
  }

  /** @inheritdoc */
  classifications(
    organizationId: string,
    ids: readonly string[],
  ): Promise<Map<string, ClassificationRow>> {
    return Promise.resolve(
      new Map(
        organizationId === ORG
          ? this.classificationRows
              .filter((row) => ids.includes(row.testRunId))
              .map((row) => [row.testRunId, row] as const)
          : [],
      ),
    );
  }

  /** @inheritdoc */
  thread(): Promise<ThreadRows> {
    return Promise.resolve(this.threadRows);
  }

  /** @inheritdoc */
  approval(prId: string): Promise<ApprovalRow | undefined> {
    return Promise.resolve(this.approvals.filter((row) => row.prId === prId).at(-1));
  }

  /** @inheritdoc */
  approvalById(approvalId: string): Promise<ApprovalRow | undefined> {
    return Promise.resolve(this.approvals.find((row) => row.id === approvalId));
  }

  /** @inheritdoc */
  loopReturns(prId: string): Promise<LoopReturnRow[]> {
    return Promise.resolve(prId === PR ? [...this.returns].reverse() : []);
  }

  /** @inheritdoc */
  spend(): Promise<{ loop: SpendTotals; verification: SpendTotals }> {
    return Promise.resolve(this.ledger);
  }

  /** @inheritdoc */
  routeCap(): Promise<RouteCapRow | undefined> {
    return Promise.resolve(this.route);
  }

  /** @inheritdoc */
  currentStage(): Promise<{ stageKey: string; attempt: number } | undefined> {
    return Promise.resolve(this.stage);
  }

  /** @inheritdoc */
  recordLoopReturn(row: NewLoopReturn): Promise<LoopReturnRow> {
    const earlier = this.returns.find((each) => each.controlId === row.controlId);

    if (earlier !== undefined) {
      return Promise.resolve(earlier);
    }

    const stored: LoopReturnRow = {
      id: uuidOf(0x1f, (this.sequence += 1)),
      revisionId: row.revisionId,
      controlId: row.controlId,
      gateKeys: [...row.gateKeys],
      expectedStageKey: row.expected?.stageKey ?? null,
      expectedAttempt: row.expected?.attempt ?? null,
      requestedBy: row.requestedBy,
      createdAt: at(40 + this.sequence),
    };

    this.returns.push(stored);
    return Promise.resolve(stored);
  }

  /** @inheritdoc */
  setHostRequest(
    approvalId: string,
    reviewer: string,
    outcome: PrApprovalHostRequest,
    detail: string | null,
  ): Promise<void> {
    this.hostRequests.push({ approvalId, outcome, detail });
    this.replace(approvalId, { hostReviewer: reviewer, hostRequest: outcome, hostDetail: detail });
    return Promise.resolve();
  }

  /** @inheritdoc */
  transaction<T>(work: (tx: PageTransaction) => Promise<T>): Promise<T> {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- the transaction is this store's view
    const store = this;

    return work({
      lockPr(organizationId: string, prId: string): Promise<LockedPr | undefined> {
        if (organizationId !== ORG || prId !== PR) {
          return Promise.resolve(undefined);
        }

        return Promise.resolve({
          id: PR,
          state: store.head514.state,
          runId: store.head514.run?.id ?? null,
          sourceId: store.head514.sourceId,
          number: store.head514.number,
          latestRevisionId: store.revisionRows.at(-1)?.id ?? null,
        });
      },
      openApproval(prId: string): Promise<ApprovalRow | undefined> {
        return Promise.resolve(
          store.approvals.find((row) => row.prId === prId && row.state === "requested"),
        );
      },
      insertApproval(prId: string, revisionId: string, requestedBy: string): Promise<string> {
        const id = uuidOf(0x42, (store.sequence += 1));

        store.approvals.push({
          id,
          prId,
          state: "requested",
          requestedRevisionId: revisionId,
          requestedBy: requestedBy === KEN.id ? KEN : { id: requestedBy, name: requestedBy },
          requestedAt: at(50 + store.sequence),
          hostReviewer: null,
          hostRequest: null,
          hostDetail: null,
          decidedRevisionId: null,
          decidedBy: null,
          decidedAt: null,
          note: null,
        });
        return Promise.resolve(id);
      },
      decideApproval(
        approvalId: string,
        state: Exclude<PrApprovalState, "requested">,
        decidedBy: string,
        revisionId: string,
        note: string | null,
      ): Promise<void> {
        store.replace(approvalId, {
          state,
          decidedBy: decidedBy === KEN.id ? KEN : { id: decidedBy, name: decidedBy },
          decidedRevisionId: revisionId,
          decidedAt: at(60),
          note,
        });
        return Promise.resolve();
      },
    });
  }

  /**
   * Replace fields of a stored slot.
   *
   * @param approvalId - The slot.
   * @param fields - What changes.
   */
  private replace(approvalId: string, fields: Partial<StoredApproval>): void {
    this.approvals = this.approvals.map((row) =>
      row.id === approvalId ? { ...row, ...fields } : row,
    );
  }
}
