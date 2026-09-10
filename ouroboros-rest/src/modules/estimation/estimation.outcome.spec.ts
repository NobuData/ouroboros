import {
  ESTIMATE_EFFORTS,
  ESTIMATE_RISKS,
  type Estimate,
  type EstimateBreakdown,
} from "../engine/engine.contract";
import { ISSUE_ESTIMATE_EFFORTS, ISSUE_ESTIMATE_RISKS } from "../db/schema";
import { estimate, FIXTURE_ISSUE_ID } from "./estimation.fixture";
import { estimateRow, statusFor } from "./estimation.outcome";

/**
 * The floor and the translation — the two decisions between an engine answer and a stored row
 * ([#107](https://github.com/NobuData/ouroboros/issues/107)).
 *
 * Pure functions, so every assertion here is a value in and a value out. What the *database*
 * then refuses is V026's business and `estimation.integration-spec.ts`'s to prove; this file
 * asserts that the row asks for what the columns are named, in the case they are named in.
 */

/** The `sized_at` every assertion here is written against — an instant with an offset. */
const SIZED_AT = new Date("2026-09-10T09:30:00.000Z");

/**
 * The breakdown, as a stored row holds it.
 *
 * @param row - What `estimateRow` produced.
 * @returns The parsed `jsonb` document.
 */
function breakdown(row: ReturnType<typeof estimateRow>): Record<string, unknown> {
  return JSON.parse(String(row.breakdown)) as Record<string, unknown>;
}

/**
 * The trace, as a stored row holds it.
 *
 * @param row - What `estimateRow` produced.
 * @returns The parsed `jsonb` document.
 */
function trace(row: ReturnType<typeof estimateRow>): Record<string, unknown> {
  return JSON.parse(String(row.trace)) as Record<string, unknown>;
}

describe("the vocabularies", () => {
  // Three places hold these five words — the engine's enum, V026's CHECK, and the union in
  // `db/schema.ts` that mirrors it — and a disagreement between any two of them is a value
  // that arrives, parses, and is refused at the column. This is the cheapest place to catch
  // it: `estimateRow` copies the engine's word straight into the row, so if the two sets ever
  // part company that assignment is the line that becomes wrong.
  it("agree between the engine's contract and the column's mirror", () => {
    expect([...ISSUE_ESTIMATE_EFFORTS]).toEqual([...ESTIMATE_EFFORTS]);
    expect([...ISSUE_ESTIMATE_RISKS]).toEqual([...ESTIMATE_RISKS]);
  });
});

describe("the confidence floor", () => {
  it.each([
    [92, 70, "sized"],
    // The mockup's own boundary: #487 at 71 is sized, #490 at 61 needs a human.
    [71, 70, "sized"],
    [61, 70, "needs_human"],
    // `<` rather than `<=`: an estimate *of* the floor clears it, which is how the engine's
    // own `needs_human()` reads the same number.
    [70, 70, "sized"],
    [69, 70, "needs_human"],
    // Both ends of the settable range are real postures, not degenerate ones.
    [0, 0, "sized"],
    [98, 100, "needs_human"],
  ])("routes %i%% against a floor of %i to %s", (confidence, floor, expected) => {
    expect(statusFor(estimate({ confidence }), floor)).toBe(expected);
  });

  it("stores an estimate under the floor in full, rather than discarding it", () => {
    // mockup 03's #490 is exactly this row: XL, 61%, deps-refresh, and a `needs human` pill
    // beside all of it. Refusing to store it would throw away the thing a person is being
    // asked to look at.
    const hedged = estimate({ confidence: 61, effort: "xl", suggestedWorkflow: "deps-refresh" });
    const row = estimateRow(FIXTURE_ISSUE_ID, 1, hedged, SIZED_AT);

    expect(statusFor(hedged, 70)).toBe("needs_human");
    expect(row.effort).toBe("xl");
    expect(row.confidence).toBe(61);
    expect(row.suggested_workflow).toBe("deps-refresh");
  });
});

describe("one engine answer as one row", () => {
  it("carries the issue, the version and every scalar the engine answered", () => {
    const row = estimateRow(FIXTURE_ISSUE_ID, 3, estimate(), SIZED_AT);

    expect(row).toMatchObject({
      github_issue_id: FIXTURE_ISSUE_ID,
      version: 3,
      effort: "m",
      confidence: 92,
      suggested_workflow: "standard-fix",
      routed_model: "claude-fable-5",
      risk: "low",
    });
    expect(row.risk_note).toContain("I²C driver path");
  });

  it("writes the breakdown under V026's own key names", () => {
    // The naming convention changes back at this boundary: these keys are stored bytes that
    // `ouroboros.issue_estimate_breakdown_valid()` looks up by name, so a camelCase document
    // would parse as JSON and be refused by the CHECK.
    expect(breakdown(estimateRow(FIXTURE_ISSUE_ID, 1, estimate(), SIZED_AT))).toEqual({
      files: ["drivers/i2c_recovery.c", "drivers/imu_bmi270.c"],
      est_tokens: 180_000,
      cycle_min: 12,
      cycle_max: 18,
      est_minutes: 23,
    });
  });

  it("writes the trace under V026's key names, and adds the clock the engine does not own", () => {
    expect(trace(estimateRow(FIXTURE_ISSUE_ID, 1, estimate(), SIZED_AT))).toEqual({
      estimator: "heuristic-v0",
      sized_at: "2026-09-10T09:30:00.000Z",
      tokens_used: 0,
      signals: expect.arrayContaining(["label: bug -> m"]) as string[],
    });
  });

  it("writes `sized_at` in the shape V026's regex accepts", () => {
    // An ISO-8601 instant *with an offset*, checked by regex because a `timestamptz` cast reads
    // the session's TimeZone and is not immutable. `toISOString()` is that shape; a local time
    // with no zone is an instant two readers would disagree about.
    const written = String(trace(estimateRow(FIXTURE_ISSUE_ID, 1, estimate(), SIZED_AT)).sized_at);

    expect(written).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/);
  });

  it("keeps an empty `files` as an empty array rather than dropping the key", () => {
    // `heuristic-v0` always answers `[]` — a rule engine cannot know which files an issue
    // touches — and N.5 renders that absence. A missing key would read as an older schema and
    // would fail V026's key count besides.
    const empty: EstimateBreakdown = { ...estimate().breakdown, files: [] };
    const row = estimateRow(FIXTURE_ISSUE_ID, 1, estimate({ breakdown: empty }), SIZED_AT);

    expect(breakdown(row).files).toEqual([]);
    expect(Object.keys(breakdown(row))).toHaveLength(5);
  });

  it("passes an estimator's own words through untouched", () => {
    // Decision K10: the trace says what produced the estimate, and this service is a writer
    // rather than an author. When O.2 (#123) answers with a model id here, nothing changes.
    const model: Estimate = estimate({
      trace: {
        estimator: "claude-fable-5",
        tokensUsed: 41_000,
        signals: ["3 similar closed issues"],
      },
    });

    expect(trace(estimateRow(FIXTURE_ISSUE_ID, 1, model, SIZED_AT))).toMatchObject({
      estimator: "claude-fable-5",
      tokens_used: 41_000,
    });
  });

  it("computes nothing — every value in the row came from the answer", () => {
    // The row is a translation. If this file ever starts deriving a value, V026's constraints
    // stop being the one place the rules live and this service becomes a second copy of them.
    const answer = estimate({ confidence: 55, effort: "l", risk: "high" });
    const row = estimateRow(FIXTURE_ISSUE_ID, 9, answer, SIZED_AT);

    expect(row.confidence).toBe(answer.confidence);
    expect(row.effort).toBe(answer.effort);
    expect(row.risk).toBe(answer.risk);
    expect(row.version).toBe(9);
  });
});
