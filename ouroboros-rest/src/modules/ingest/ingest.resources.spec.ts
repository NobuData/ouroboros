import type {
  ChangeSetResource,
  CommitsAppendedResource,
  EventsAppendedResource,
  ResourcesReportedResource,
  RunOpenedResource,
  StageTransitionResource,
} from "./ingest.resources";

/**
 * The six answers, and the one property that binds them: **each survives being stored and
 * returned**.
 *
 * A replay does not recompute anything. It reads `run_ingest_receipts.response` — a `jsonb`
 * column — and hands it back, so *"it looked right in the response"* and *"it is the same
 * thing after a round trip"* are different claims and only the second one is the contract. A
 * `Date` that rendered correctly the first time would come back as a string on the replay,
 * and the two answers to one key would differ in type.
 *
 * `JSON.parse(JSON.stringify(x))` is the round trip `jsonb` performs, near enough: both drop
 * `undefined`, both render a `Date` as an ISO string, and both keep `null`. Asserting
 * equality across it is what makes a `Date` added to one of these shapes fail here rather
 * than in a caller's retry six weeks later.
 */

/** One example of each answer, filled the way the service fills it. */
const ANSWERS = {
  "a run that was opened": {
    id: "5eed0009-0000-4000-8000-000000000482",
    loopSeq: 1847,
    organizationId: "acme-robotics-id",
    issueNumber: 482,
    issueTitle: "Fix flaky CAN-bus telemetry test",
    workflowTag: "standard-fix",
    workflowVersionPin: 14,
    branchName: "loop/482-canbus-flake",
    mergeStrategy: "squash",
    model: "claude-fable-5",
    simulated: true,
    status: "coding",
    startedAt: "2026-09-22T14:25:01.000Z",
  } satisfies RunOpenedResource,

  "a stage transition": {
    runStageId: "5eed002a-0000-4000-8000-000000000004",
    stageKey: "implement",
    stageLabel: "Code the change",
    position: 7,
    attempt: 2,
    maxAttempts: 3,
    tokenBudget: 400_000,
    status: "active",
    note: "attempt 1 failed tests — loop returned from gate ↺",
    startedAt: "2026-09-22T14:32:56.000Z",
    finishedAt: null,
    returnedFrom: { stageKey: "checks-green", kind: "gate", reason: "failed_tests" },
  } satisfies StageTransitionResource,

  "an appended batch": {
    submitted: 2,
    stored: 2,
    firstSeq: 8,
    lastSeq: 9,
    hint: 22,
    elided: false,
  } satisfies EventsAppendedResource,

  "a change-set": {
    changeSetSeq: 3,
    files: 2,
    additions: 59,
    deletions: 12,
    guardrailChecks: 4,
  } satisfies ChangeSetResource,

  "appended commits": {
    submitted: 2,
    appended: 1,
    duplicates: 1,
    lastSeq: 2,
  } satisfies CommitsAppendedResource,

  "reported resources": {
    tokensIn: 164_000,
    tokensOut: 48_000,
    costCents: "114.0000",
    unpricedEvents: 0,
    reservedBuildJobId: "5eed0008-0000-4000-8000-000000000483",
  } satisfies ResourcesReportedResource,
} as const;

/** What `jsonb` does to a value on its way in and out. */
function roundTrip(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

describe("every answer", () => {
  it.each(Object.entries(ANSWERS))("%s survives the receipt round trip", (_name, answer) => {
    expect(roundTrip(answer)).toEqual(answer);
  });

  it.each(Object.entries(ANSWERS))("%s holds no Date", (_name, answer) => {
    // Times are ISO 8601 strings, as in every contract this service publishes — and here for
    // an extra reason: a `Date` would come back from `jsonb` as a string, so the first answer
    // and its replay would differ in type.
    for (const value of Object.values(answer)) {
      expect(value).not.toBeInstanceOf(Date);
    }
  });

  it.each(Object.entries(ANSWERS))(
    "%s writes absence as null, never as undefined",
    (_name, answer) => {
      // `jsonb` has no `undefined`, so a key holding one would simply vanish on the replay and
      // the two answers to one key would have different shapes.
      for (const value of Object.values(answer)) {
        expect(value).not.toBeUndefined();
      }
    },
  );
});

describe("the answers that are not echoes", () => {
  it("returns counts for a batch rather than the entries", () => {
    // The caller sent the entries. What it cannot know is the dense `seq` the store allocated
    // and whether a cap elided anything, so that is what comes back.
    expect(Object.keys(ANSWERS["an appended batch"]).toSorted()).toEqual([
      "elided",
      "firstSeq",
      "hint",
      "lastSeq",
      "stored",
      "submitted",
    ]);
  });

  it("returns totals for a change-set rather than the files", () => {
    expect(Object.keys(ANSWERS["a change-set"]).toSorted()).toEqual([
      "additions",
      "changeSetSeq",
      "deletions",
      "files",
      "guardrailChecks",
    ]);
  });
});

describe("money", () => {
  it("is a decimal string, because numeric(14,4) does not round-trip through a double", () => {
    const cost = ANSWERS["reported resources"].costCents;

    expect(typeof cost).toBe("string");
    expect(roundTrip(cost)).toBe(cost);
  });

  it("admits null for a run whose every attributed row is unpriced", () => {
    // Decisions M7 and N10's count-only case. `"0"` would say the run cost nothing about a
    // run whose model simply has no price in the catalog.
    const unpriced: ResourcesReportedResource = {
      tokensIn: 12_000,
      tokensOut: 3_400,
      costCents: null,
      unpricedEvents: 4,
      reservedBuildJobId: null,
    };

    expect(roundTrip(unpriced)).toEqual(unpriced);
  });
});
