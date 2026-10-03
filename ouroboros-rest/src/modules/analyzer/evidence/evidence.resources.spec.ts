import {
  CCACHE_SHA,
  changePoint,
  FIRST_AFTER_ID,
  LAST_BEFORE_ID,
  POLICY_VERSION_ID,
  resolvedEvidence,
} from "../duration/duration.fixture";
import {
  evidenceIds,
  evidenceResource,
  groupRefs,
  refOf,
  refsOf,
  WAIVER_LABEL_MAX,
} from "./evidence.resources";

/**
 * What an evidence reference resolves to (BW.2, #517; shared and widened by BW.3, #518): every
 * kind V081 knows opens on the surface that shows it, and a reference whose row is gone opens
 * nothing rather than somewhere plausible.
 */

/** A test run of loop `run-1` — its third build. */
const TEST_RUN = { id: "test-run-1", run_id: "run-1", attempt_seq: 3 };

/** A case of that attempt. */
const TEST_CASE = {
  id: "case-1",
  run_id: "run-1",
  attempt_seq: 3,
  suite: "telemetry integration",
  name: "ring buffer drains under burst",
};

/** What nothing in the workspace answers to. */
const OPENS_NOTHING = {
  label: null,
  surface: null,
  pullRequestId: null,
  workflowSlug: null,
  runId: null,
  attempt: null,
  suiteName: null,
  caseName: null,
};

describe("evidence references", () => {
  it("are grouped by kind for one resolving read, each id once", () => {
    const ids = evidenceIds([
      changePoint(),
      changePoint({
        evidence_refs: [
          { kind: "merge", id: CCACHE_SHA },
          { kind: "runner_pool", id: "pool-1" },
          { kind: "runner", id: "runner-1" },
          { kind: "waiver", id: "waiver-1" },
          { kind: "test_run", id: "test-run-1" },
          { kind: "test_case", id: "case-1" },
          { kind: "test_case", id: "case-1" },
        ],
      }),
    ]);

    expect(ids).toEqual({
      builds: [LAST_BEFORE_ID, FIRST_AFTER_ID],
      merges: [CCACHE_SHA],
      workflowVersions: [POLICY_VERSION_ID],
      runnerPools: ["pool-1"],
      runners: ["runner-1"],
      testRuns: ["test-run-1"],
      testCases: ["case-1"],
      waivers: ["waiver-1"],
    });
  });

  it("leave a kind V081 does not know out of the read", () => {
    expect(groupRefs([{ kind: "custom:thing", id: "x" }])).toEqual({
      builds: [],
      merges: [],
      workflowVersions: [],
      runnerPools: [],
      runners: [],
      testRuns: [],
      testCases: [],
      waivers: [],
    });
  });

  it("are read from a finding in their stored order, a malformed one as empty", () => {
    expect(refsOf({ evidence_refs: [{ kind: "build", id: "b" }, "nonsense", null] })).toEqual([
      { kind: "build", id: "b" },
      { kind: "", id: "" },
      { kind: "", id: "" },
    ]);
    expect(refsOf({ evidence_refs: null })).toEqual([]);
    expect(refOf({ kind: 7, id: ["x"] })).toEqual({ kind: "", id: "" });
  });

  it("open a merge on its mirrored pull request", () => {
    expect(evidenceResource({ kind: "merge", id: CCACHE_SHA }, resolvedEvidence())).toEqual({
      ...OPENS_NOTHING,
      kind: "merge",
      id: CCACHE_SHA,
      label: "ccache enabled",
      surface: "pull_request",
      pullRequestId: "5eed0052-0000-4000-8000-000000000482",
    });
  });

  it("open a merge the mirror has no PR for on the farm that built it", () => {
    const resolved = resolvedEvidence({
      merges: [{ sha: CCACHE_SHA, title: "ccache enabled", pull_request_id: null }],
    });

    expect(evidenceResource({ kind: "merge", id: CCACHE_SHA }, resolved)).toMatchObject({
      label: "ccache enabled",
      surface: "farm",
      pullRequestId: null,
    });
  });

  it("open a workflow version in the studio, a draft named as one", () => {
    const ref = { kind: "workflow_version", id: POLICY_VERSION_ID };

    expect(evidenceResource(ref, resolvedEvidence())).toMatchObject({
      label: "standard-fix v9",
      surface: "workflow",
      workflowSlug: "standard-fix",
    });
    expect(
      evidenceResource(
        ref,
        resolvedEvidence({
          workflowVersions: [{ id: POLICY_VERSION_ID, slug: "standard-fix", version: null }],
        }),
      ).label,
    ).toBe("standard-fix draft");
  });

  it("open a build, a pool and a runner on the farm", () => {
    const resolved = resolvedEvidence({
      runnerPools: [{ id: "pool-1", name: "pool-a" }],
      runners: [{ id: "runner-1", name: "forge-02" }],
    });

    expect(evidenceResource({ kind: "build", id: LAST_BEFORE_ID }, resolved)).toMatchObject({
      label: "#641 · zephyr build",
      surface: "farm",
    });
    expect(evidenceResource({ kind: "runner_pool", id: "pool-1" }, resolved)).toMatchObject({
      label: "pool-a",
      surface: "farm",
    });
    expect(evidenceResource({ kind: "runner", id: "runner-1" }, resolved)).toMatchObject({
      label: "forge-02",
      surface: "farm",
    });
  });

  it("open a test run on its loop's test results, at that attempt", () => {
    const resolved = resolvedEvidence({ testRuns: [TEST_RUN] });

    expect(evidenceResource({ kind: "test_run", id: "test-run-1" }, resolved)).toEqual({
      ...OPENS_NOTHING,
      kind: "test_run",
      id: "test-run-1",
      label: "Build 3",
      surface: "test_results",
      runId: "run-1",
      attempt: 3,
    });
  });

  it("open a test case on the attempt it ran in, with its suite and itself selected", () => {
    const resolved = resolvedEvidence({ testCases: [TEST_CASE] });

    expect(evidenceResource({ kind: "test_case", id: "case-1" }, resolved)).toEqual({
      ...OPENS_NOTHING,
      kind: "test_case",
      id: "case-1",
      label: "ring buffer drains under burst",
      surface: "test_results",
      runId: "run-1",
      attempt: 3,
      suiteName: "telemetry integration",
      caseName: "ring buffer drains under burst",
    });
  });

  it("open a waiver on the pull request its loop opened", () => {
    const resolved = resolvedEvidence({
      waivers: [
        {
          id: "waiver-1",
          run_id: "run-1",
          reason: "No thermal chamber on helios-rig-02",
          pull_request_id: "pr-1",
        },
      ],
    });

    expect(evidenceResource({ kind: "waiver", id: "waiver-1" }, resolved)).toEqual({
      ...OPENS_NOTHING,
      kind: "waiver",
      id: "waiver-1",
      label: "No thermal chamber on helios-rig-02",
      surface: "pull_request",
      pullRequestId: "pr-1",
    });
  });

  it("open a waiver whose loop has no mirrored PR on that loop's test results", () => {
    const resolved = resolvedEvidence({
      waivers: [
        { id: "waiver-1", run_id: "run-1", reason: "thermal\n  coverage", pull_request_id: null },
      ],
    });

    expect(evidenceResource({ kind: "waiver", id: "waiver-1" }, resolved)).toEqual({
      ...OPENS_NOTHING,
      kind: "waiver",
      id: "waiver-1",
      label: "thermal coverage",
      surface: "test_results",
      runId: "run-1",
    });
  });

  it("cut a long waiver reason to one line of a label, never mid-sentence into nothing", () => {
    const resolved = resolvedEvidence({
      waivers: [
        { id: "waiver-1", run_id: "run-1", reason: "x".repeat(400), pull_request_id: null },
      ],
    });
    const label = evidenceResource({ kind: "waiver", id: "waiver-1" }, resolved).label ?? "";

    expect([...label]).toHaveLength(WAIVER_LABEL_MAX);
    expect(label.endsWith("…")).toBe(true);
  });

  it.each([
    ["a build retention has removed", { kind: "build", id: FIRST_AFTER_ID }],
    ["a merge nothing in the workspace recorded", { kind: "merge", id: "feedbee" }],
    ["a pool that is gone", { kind: "runner_pool", id: "pool-9" }],
    ["a test run that is gone", { kind: "test_run", id: "test-run-9" }],
    ["a test case that is gone", { kind: "test_case", id: "case-9" }],
    ["a waiver that is gone", { kind: "waiver", id: "waiver-9" }],
    ["a kind V081 does not know", { kind: "custom:thing", id: "x" }],
  ])("leave %s named by its reference alone, opening nothing", (_about, ref) => {
    expect(evidenceResource(ref, resolvedEvidence())).toEqual({ ...ref, ...OPENS_NOTHING });
  });
});
