import { backfillDue, type FamilyState } from "./rollup.plan";

/**
 * When a tick starts a backfill (BI.2, #433): a first fill reaches the horizon, the first tick of a
 * new UTC day consolidates the trailing window plus any gap, a backfill in progress is left alone,
 * and nothing reaches past the horizon.
 */

const TODAY = "2026-09-01";
const LIMITS = { backfillDays: 90, consolidateDays: 3 };

/**
 * A family's bookkeeping.
 *
 * @param state - What to set.
 * @returns The state, unset fields null.
 */
function state(state: Partial<FamilyState>): FamilyState {
  return { lastFilledDay: null, backfillCursor: null, backfillUntil: null, ...state };
}

describe("when a backfill is due", () => {
  it("fills the whole horizon, ending yesterday, for a family never filled", () => {
    expect(backfillDue(undefined, TODAY, LIMITS)).toEqual({
      from: "2026-06-03",
      until: "2026-08-31",
    });
    expect(backfillDue(state({}), TODAY, LIMITS)).toEqual({
      from: "2026-06-03",
      until: "2026-08-31",
    });
  });

  it("does nothing while yesterday is already filled — the rest of the day is hourly tails", () => {
    expect(backfillDue(state({ lastFilledDay: "2026-08-31" }), TODAY, LIMITS)).toBeUndefined();
  });

  it("consolidates the trailing window on the first tick of a new day", () => {
    expect(backfillDue(state({ lastFilledDay: "2026-08-30" }), TODAY, LIMITS)).toEqual({
      from: "2026-08-29",
      until: "2026-08-31",
    });
  });

  it("covers the whole gap after an outage longer than the window", () => {
    expect(backfillDue(state({ lastFilledDay: "2026-08-20" }), TODAY, LIMITS)).toEqual({
      from: "2026-08-21",
      until: "2026-08-31",
    });
  });

  it("never reaches past the horizon, however long the outage", () => {
    expect(backfillDue(state({ lastFilledDay: "2025-01-01" }), TODAY, LIMITS)).toEqual({
      from: "2026-06-03",
      until: "2026-08-31",
    });
  });

  it("leaves a backfill in progress to finish", () => {
    expect(
      backfillDue(
        state({
          lastFilledDay: "2026-08-01",
          backfillCursor: "2026-08-10",
          backfillUntil: "2026-08-20",
        }),
        TODAY,
        LIMITS,
      ),
    ).toBeUndefined();
    expect(
      backfillDue(
        state({ backfillCursor: "2026-06-03", backfillUntil: "2026-08-31" }),
        TODAY,
        LIMITS,
      ),
    ).toBeUndefined();
  });

  it("honours a one-day horizon and window", () => {
    expect(backfillDue(undefined, TODAY, { backfillDays: 1, consolidateDays: 1 })).toEqual({
      from: "2026-08-31",
      until: "2026-08-31",
    });
    expect(
      backfillDue(state({ lastFilledDay: "2026-08-30" }), TODAY, {
        backfillDays: 1,
        consolidateDays: 1,
      }),
    ).toEqual({ from: "2026-08-31", until: "2026-08-31" });
  });
});
