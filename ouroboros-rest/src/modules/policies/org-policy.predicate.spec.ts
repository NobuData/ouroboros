import { evaluatePredicate } from "./org-policy.predicate";

/**
 * The policy grammar's one evaluator (BQ.2, #481) — shared by `auto_merge` and `human_review`, so
 * the two cannot disagree about what a predicate means.
 */

const SMALL_FIX = { labels: ["bug"], effort: "s" as const };

describe("evaluatePredicate", () => {
  it("compares efforts on the xs < s < m < l < xl scale, inclusively", () => {
    expect(evaluatePredicate({ effort_lte: "s" }, SMALL_FIX).holds).toBe(true);
    expect(evaluatePredicate({ effort_lte: "xs" }, SMALL_FIX).holds).toBe(false);
    expect(evaluatePredicate({ effort_gte: "s" }, SMALL_FIX).holds).toBe(true);
    expect(evaluatePredicate({ effort_gte: "m" }, SMALL_FIX).holds).toBe(false);
  });

  it("satisfies no size comparison for an unestimated ticket", () => {
    expect(evaluatePredicate({ effort_lte: "xl" }, { labels: [], effort: undefined }).holds).toBe(
      false,
    );
    expect(evaluatePredicate({ effort_gte: "xs" }, { labels: [], effort: undefined }).holds).toBe(
      false,
    );
  });

  it("composes with all, any and not — the mockup's effort ≤ M · non-refactor", () => {
    const autoMerge = { all: [{ effort_lte: "m" }, { not: { label: "refactor" } }] };

    expect(evaluatePredicate(autoMerge, SMALL_FIX).holds).toBe(true);
    expect(evaluatePredicate(autoMerge, { labels: ["refactor"], effort: "s" }).holds).toBe(false);
    expect(
      evaluatePredicate({ any: [{ label: "docs" }, { effort_gte: "l" }] }, SMALL_FIX).holds,
    ).toBe(false);
  });

  it("names the labels that made it true positively — never one under a not", () => {
    expect(
      evaluatePredicate(
        { any: [{ label: "refactor" }, { label: "bug" }] },
        { labels: ["refactor", "bug"], effort: "s" },
      ).labels,
    ).toEqual(["refactor", "bug"]);
    expect(evaluatePredicate({ not: { label: "docs" } }, SMALL_FIX)).toEqual({
      holds: true,
      labels: [],
    });
  });

  it.each([
    ["an unknown key", { sometimes: true }],
    ["two keys at once", { label: "a", effort_lte: "m" }],
    ["an empty any", { any: [] }],
    ["an unknown effort", { effort_lte: "huge" }],
    ["a label that is not a string", { label: 7 }],
    ["a malformed part inside all", { all: [{ label: "bug" }, { what: 1 }] }],
    ["an array", [{ label: "bug" }]],
    ["nothing", null],
  ])("holds neither way for %s", (_why, predicate) => {
    expect(evaluatePredicate(predicate, SMALL_FIX).holds).toBeUndefined();
  });

  it("propagates an unreadable inner predicate through not", () => {
    expect(evaluatePredicate({ not: { what: 1 } }, SMALL_FIX).holds).toBeUndefined();
  });
});
