import { aggregate } from "../gates/gate.engine";
import {
  citedTestRunId,
  filesResource,
  loopReturnResource,
  reviewResource,
  stripResources,
  summaryResource,
  type StripInput,
} from "./page.resources";
import {
  ATTEMPT_3,
  ATTEMPT_4,
  FakePageStore,
  HEAD,
  KEN,
  REV_1,
  REV_2,
  gateRows,
  revisions,
} from "./page.store.fixture";

/**
 * The page's shapes (AX.5, [#361](https://github.com/NobuData/ouroboros/issues/361)) — above all the
 * strip, whose every step is a join (decision V4): per-revision snapshots, the attempt each
 * revision's own test verdict cites, and the correction read from the revision before.
 */

/** The strip's input over the mockup universe. */
function input(changes: Partial<StripInput> = {}): StripInput {
  const store = new FakePageStore();
  const rows = gateRows();

  return {
    revisions: revisions(),
    gateRows: rows,
    aggregates: new Map(
      [REV_1, REV_2].map((id) => [
        id,
        aggregate(rows.filter((row) => row.revisionId === id).map((row) => ({ ...row }))),
      ]),
    ),
    attempts: store.attempts,
    classifications: new Map(store.classificationRows.map((row) => [row.testRunId, row])),
    loopReturns: [],
    ...changes,
  };
}

describe("stripResources", () => {
  it("returns each revision's own snapshot — so the gates card can be scoped to Revision 1", () => {
    const [first, second] = stripResources(input());

    expect(first.gates).toMatchObject({
      revisionId: REV_1,
      aggregate: { requiredCount: 7, greenCount: 3, redCount: 2, mergeReady: false },
    });
    expect(first.gates.rows.filter((row) => row.verdict === "red").map((row) => row.key)).toEqual([
      "test_suite",
      "physical_hil",
    ]);
    expect(second.gates.aggregate).toEqual({
      requiredCount: 7,
      greenCount: 5,
      redCount: 0,
      satisfiedCount: 6,
      mergeReady: false,
    });
    expect(second.gates.rows.map((row) => row.key)).toEqual([
      "build",
      "test_suite",
      "physical_hil",
      "diff_vs_plan",
      "secrets_license",
      "model_review",
      "human_approval",
    ]);
  });

  it("names the attempt each revision's test verdict cites — attempt 3, then attempt 4", () => {
    expect(stripResources(input()).map((revision) => revision.testAttempt)).toEqual([
      { id: ATTEMPT_3, attemptSeq: 3 },
      { id: ATTEMPT_4, attemptSeq: 4 },
    ]);
  });

  it("bridges Revision 1 to 2 with the classification on Revision 1's attempt and its loop return", () => {
    const loopReturn = {
      id: "lr-1",
      revisionId: REV_1,
      controlId: "control-1",
      gateKeys: ["physical_hil"],
      expectedStageKey: "implement",
      expectedAttempt: 3,
      requestedBy: KEN.id,
      createdAt: new Date("2026-09-27T14:15:00Z"),
    };
    const [first, second] = stripResources(input({ loopReturns: [loopReturn] }));

    expect(first.correction).toBeNull();
    expect(second.correction).toEqual({
      fromRevisionId: REV_1,
      classification: expect.objectContaining({
        testRunId: ATTEMPT_3,
        class: "product_bug",
        actor: "heuristic",
        note: null,
      }) as unknown,
      loopReturn: loopReturnResource(loopReturn),
    });
  });

  it("leaves a revision never evaluated with no aggregate and no rows, and no attempt", () => {
    const [, second] = stripResources(
      input({ gateRows: gateRows().filter((row) => row.revisionId === REV_1) }),
    );

    expect(second.gates).toEqual({ revisionId: REV_2, aggregate: null, rows: [] });
    expect(second.testAttempt).toBeNull();
    expect(second.correction?.classification).not.toBeNull();
  });
});

describe("citedTestRunId", () => {
  it("reads only a test_run link on the test_suite gate", () => {
    expect(citedTestRunId(gateRows().filter((row) => row.revisionId === REV_2))).toBe(ATTEMPT_4);
    expect(
      citedTestRunId([{ ...gateRows()[1], evidenceRef: { kind: "build_job", id: ATTEMPT_3 } }]),
    ).toBeUndefined();
    expect(citedTestRunId([])).toBeUndefined();
  });
});

describe("filesResource", () => {
  it("is the changed-files card — rows, totals, excerpt and the host's full diff", () => {
    const files = filesResource(revisions()[1], `${HEAD.url}/`);

    expect(files).toMatchObject({
      revisionId: REV_2,
      additions: 68,
      deletions: 15,
      fullDiffUrl: `${HEAD.url}/files`,
    });
    expect(files.rows).toHaveLength(3);
    expect(files.diffExcerpt).toContain("telemetry_buf.c:41");
  });
});

describe("summaryResource", () => {
  it("carries the latest revision's aggregate and the needs-you flag", () => {
    const summary = summaryResource(
      { ...HEAD, latestRevision: revisions()[1], reviewRequested: true },
      aggregate([{ required: true, verdict: "green" }]),
    );

    expect(summary).toMatchObject({
      number: 514,
      latestRevision: { id: REV_2, seq: 2, headSha: "b7e41d0" },
      gates: { requiredCount: 1, greenCount: 1 },
      reviewRequested: true,
    });
  });

  it("has no aggregate for a PR with no revision", () => {
    expect(
      summaryResource({ ...HEAD, latestRevision: null, reviewRequested: false }, undefined).gates,
    ).toBeNull();
  });

  it("carries the head's sync stamp, and none for a PR never synced", () => {
    const row = { ...HEAD, latestRevision: null, reviewRequested: false };

    expect(summaryResource(row, undefined).syncedAt).toBe(HEAD.syncedAt?.toISOString());
    expect(summaryResource({ ...row, syncedAt: null }, undefined).syncedAt).toBeNull();
  });
});

describe("reviewResource", () => {
  it("names the host request only when a host login was asked", () => {
    const row = {
      id: "a-1",
      state: "requested" as const,
      requestedRevisionId: REV_2,
      requestedBy: KEN,
      requestedAt: new Date("2026-09-27T15:00:00Z"),
      hostReviewer: null,
      hostRequest: null,
      hostDetail: null,
      decidedRevisionId: null,
      decidedBy: null,
      decidedAt: null,
      note: null,
    };

    expect(reviewResource(row).host).toBeNull();
    expect(
      reviewResource({ ...row, hostReviewer: "priya", hostRequest: "failed", hostDetail: "403" })
        .host,
    ).toEqual({ reviewer: "priya", state: "failed", detail: "403" });
  });
});
