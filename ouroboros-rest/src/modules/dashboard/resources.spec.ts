import { ACTIVE_RUN_STATUSES, type QueueItem, type Run } from "../db/schema";
import { loopsLive, queueItemSummary, rate, runSummary } from "./resources";

/**
 * Row → resource, and the two claims the mapping makes that a card depends on: that a run in
 * flight and a run that has stopped are one shape, and that absence is a zero or a null
 * according to which of the two it actually is.
 */

/** The mockup's first live loop, as V008 stores one. */
const LIVE: Run = {
  id: "5eed0009-0000-4000-8000-000000000482",
  organization_id: "acme",
  github_repo_id: "5eed0003-0000-4000-8000-000000000001",
  issue_number: 482,
  issue_title: "Fix flaky CAN-bus telemetry test",
  workflow_tag: "standard-fix",
  model: "claude-fable-5",
  status: "coding",
  stage_label: "Implementing",
  stage_index: 4,
  stage_total: 6,
  started_at: new Date("2026-08-13T14:25:01.000Z"),
  finished_at: null,
  pr_number: null,
  checks_passed: null,
  checks_total: null,
  created_at: new Date("2026-08-13T14:25:01.000Z"),
  updated_at: new Date("2026-08-13T14:37:00.000Z"),
};

/** Its counterpart on the completions card — the same table, the other half of decision F2. */
const CLOSED: Run = {
  ...LIVE,
  id: "5eed0009-0000-4000-8000-000000000474",
  issue_number: 474,
  issue_title: "Debounce e-stop interrupt handler",
  status: "merged",
  stage_label: "Merged",
  stage_index: 6,
  finished_at: new Date("2026-08-13T14:00:00.000Z"),
  pr_number: 512,
  checks_passed: 14,
  checks_total: 14,
};

/** A queued issue that nobody has sized. */
const QUEUED: QueueItem = {
  id: "5eed000a-0000-4000-8000-000000000496",
  organization_id: "acme",
  github_repo_id: "5eed0003-0000-4000-8000-000000000001",
  issue_number: 496,
  issue_title: "Telemetry: split ingest into a worker pool",
  effort: "m",
  workflow_tag: "feature-loop",
  position: 12,
  est_minutes: null,
  enqueued_at: new Date("2026-08-13T13:37:41.000Z"),
  created_at: new Date("2026-08-13T13:37:41.000Z"),
  updated_at: new Date("2026-08-13T13:37:41.000Z"),
};

describe("a run, as a card draws it", () => {
  it("renames the columns without reinterpreting them", () => {
    expect(runSummary(LIVE)).toEqual({
      id: LIVE.id,
      issueNumber: 482,
      issueTitle: "Fix flaky CAN-bus telemetry test",
      workflowTag: "standard-fix",
      model: "claude-fable-5",
      status: "coding",
      stageLabel: "Implementing",
      stageIndex: 4,
      stageTotal: 6,
      startedAt: "2026-08-13T14:25:01.000Z",
      finishedAt: null,
      prNumber: null,
      checksPassed: null,
      checksTotal: null,
    });
  });

  it("gives a closed run the same shape, filled in rather than extended", () => {
    // Decision F2 read forwards: two cards, one entity, one resource. A second shape here
    // would be this module claiming a distinction the schema deliberately does not make.
    const closed = runSummary(CLOSED);

    expect(Object.keys(closed).sort()).toEqual(Object.keys(runSummary(LIVE)).sort());
    expect(closed.finishedAt).toBe("2026-08-13T14:00:00.000Z");
    expect(closed.prNumber).toBe(512);
    expect(closed.checksPassed).toBe(14);
  });

  it("carries no elapsed and no cycle time", () => {
    // Both are `now − startedAt` and `finishedAt − startedAt`, and both are the client's:
    // elapsed moves while nobody is asking, so a number computed here would be wrong by the
    // time it was rendered. The instants are what is sent.
    expect(runSummary(LIVE)).not.toHaveProperty("elapsedSeconds");
    expect(runSummary(CLOSED)).not.toHaveProperty("cycleSeconds");
  });

  it("does not confuse a run with no checks and a run whose checks all failed", () => {
    const noChecks = runSummary({ ...CLOSED, checks_passed: null, checks_total: null });
    const zeroOfZero = runSummary({ ...CLOSED, checks_passed: 0, checks_total: 0 });

    expect(noChecks.checksTotal).toBeNull();
    expect(zeroOfZero.checksTotal).toBe(0);
  });
});

describe("a queued issue", () => {
  it("preserves an absent estimate rather than calling it zero", () => {
    // `est_minutes` is nullable precisely so that "not sized yet" has a value. A card
    // rendering a null as `0m` would be inventing a claim about how long the work takes.
    expect(queueItemSummary(QUEUED).estMinutes).toBeNull();
    expect(queueItemSummary({ ...QUEUED, est_minutes: 45 }).estMinutes).toBe(45);
  });

  it("renames the columns without reinterpreting them", () => {
    expect(queueItemSummary(QUEUED)).toEqual({
      id: QUEUED.id,
      issueNumber: 496,
      issueTitle: "Telemetry: split ingest into a worker pool",
      effort: "m",
      workflowTag: "feature-loop",
      position: 12,
      estMinutes: null,
      enqueuedAt: "2026-08-13T13:37:41.000Z",
    });
  });
});

describe("the live-loops split", () => {
  it("carries every active status as a key, zeros included", () => {
    // The acceptance criterion about empty organizations, at the level it is actually
    // decided: a subline is composed from these keys, and a client should not have to know
    // which statuses exist to render one.
    expect(loopsLive({ coding: 0, building: 0, review: 0 })).toEqual({
      total: 0,
      byStatus: { coding: 0, building: 0, review: 0 },
    });
  });

  it("keys the split in lifecycle order", () => {
    // JSON preserves insertion order, and a subline reading down the pipeline is composed
    // from these keys in the order they appear.
    expect(Object.keys(loopsLive({ coding: 1, building: 1, review: 1 }).byStatus)).toEqual([
      ...ACTIVE_RUN_STATUSES,
    ]);
  });

  it("sums the total from the parts rather than counting twice", () => {
    // Two counts of one thing are two things that can disagree, and the card draws the total
    // above the split that is supposed to explain it.
    const live = loopsLive({ coding: 1, building: 1, review: 1 });

    expect(live.total).toBe(3);
    expect(live.total).toBe(Object.values(live.byStatus).reduce((sum, one) => sum + one, 0));
  });
});

describe("a rate over a window", () => {
  it("is the fraction when the window holds something", () => {
    // The seeded fourteen days: 46 merged of 50 closed, which is the mockup's 92% with no
    // rounding at all — the reason the merge rate's window is what it is.
    expect(rate(46, 50)).toBe(0.92);
  });

  it("is zero when the window holds nothing, and never NaN", () => {
    // `NaN` is not representable in JSON: it would reach a card as `null` and a meter as a
    // width of `NaN%`. The zero is a floor rather than a measurement — see `LoopPulse`.
    expect(rate(0, 0)).toBe(0);
    expect(Number.isNaN(rate(0, 0))).toBe(false);
  });

  it("is one for a window in which everything merged", () => {
    expect(rate(3, 3)).toBe(1);
  });
});
