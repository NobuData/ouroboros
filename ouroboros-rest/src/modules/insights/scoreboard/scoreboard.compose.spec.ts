import {
  MOCKUP_15_RENDERED,
  MOCKUP_15_SCOREBOARD,
  mockupTallies,
  renderScoreboardRow,
  SPARSE_ROW,
  TOKENS_PER_LOOP,
  UNPRICED_ROW,
} from "../../../testing/scoreboard.fixture";
import {
  composeRows,
  costOf,
  keyOf,
  roleOf,
  SCOREBOARD_MIN_SAMPLE,
  trendOf,
  untouchedRateOf,
} from "./scoreboard.compose";
import type { ScoreboardTally } from "./scoreboard.types";

/**
 * The scoreboard's arithmetic (BJ.3, #439): mockup 15's rows from the shared fixture, the
 * low-sample badge, unpriced usage, local models, trends and roles.
 */

/**
 * A tally with defaults for what a case does not care about.
 *
 * @param overrides - The fields that matter.
 * @returns The tally.
 */
function tally(overrides: Partial<ScoreboardTally>): ScoreboardTally {
  return {
    taskKind: "implement",
    model: "claude-fable-5",
    hop: 1,
    merged: 20,
    untouched: 18,
    tokens: 1000,
    unpricedTokens: 0,
    costCents: 100,
    ...overrides,
  };
}

describe("the scoreboard's arithmetic", () => {
  describe("mockup 15's seeded rows", () => {
    const rows = composeRows(
      mockupTallies(MOCKUP_15_SCOREBOARD, "current"),
      mockupTallies(MOCKUP_15_SCOREBOARD, "prior"),
    );

    it("reproduce the card: 84% $0.87 ▲, the fallback's 61% $0.94 ▼, the local $0.00 —, 91% $0.22 ▲", () => {
      expect(rows.map(renderScoreboardRow)).toEqual(MOCKUP_15_RENDERED.map((row) => [...row]));
    });

    it("annotate the fallback row with its hop and role", () => {
      const fallback = rows.find((row) => row.model === "copilot/gpt-5-codex");

      expect(fallback).toMatchObject({ taskKind: "implement", hop: 2, role: "fallback" });
      expect(rows.filter((row) => row.role === "fallback")).toHaveLength(1);
    });

    it("price the local model at $0.00 rather than leaving it out", () => {
      const local = rows.find((row) => row.model === "ollama/qwen3-coder");

      expect(local?.cost).toEqual({ pricing: "priced", cents: 0, centsPerSuccess: 0 });
    });

    it("carry no low-sample badge on rows backed by enough merges", () => {
      expect(rows.every((row) => row.merged >= SCOREBOARD_MIN_SAMPLE && !row.lowSample)).toBe(true);
    });
  });

  describe("a sparse row", () => {
    it("is kept, with its rate and a low-sample badge — neither dropped nor shown bare", () => {
      const rows = composeRows(
        mockupTallies([...MOCKUP_15_SCOREBOARD, SPARSE_ROW], "current"),
        mockupTallies([...MOCKUP_15_SCOREBOARD, SPARSE_ROW], "prior"),
      );
      const sparse = rows.find((row) => row.taskKind === SPARSE_ROW.taskKind);

      expect(rows).toHaveLength(MOCKUP_15_SCOREBOARD.length + 1);
      expect(sparse).toMatchObject({ merged: 3, untouchedRate: 100, lowSample: true });
      expect(rows.filter((row) => row.lowSample)).toEqual([sparse]);
    });

    it("badges strictly below the threshold", () => {
      const [below, at] = composeRows(
        [
          tally({ taskKind: "a", merged: SCOREBOARD_MIN_SAMPLE - 1, untouched: 1 }),
          tally({ taskKind: "b", merged: SCOREBOARD_MIN_SAMPLE, untouched: 1 }),
        ],
        [],
      ).sort((x, y) => x.taskKind.localeCompare(y.taskKind));

      expect(below.lowSample).toBe(true);
      expect(at.lowSample).toBe(false);
    });

    it("keeps a model that has spent but not yet merged, with no rate and no cost per success", () => {
      const [row] = composeRows([tally({ merged: 0, untouched: 0, costCents: 300 })], []);

      expect(row).toMatchObject({ merged: 0, untouchedRate: null, lowSample: true });
      expect(row.cost).toEqual({ pricing: "priced", cents: 300, centsPerSuccess: null });
      expect(row.trend.direction).toBe("flat");
    });
  });

  describe("$ / success", () => {
    it("shows tokens, never dollars, for unpriced usage", () => {
      const [row] = composeRows(mockupTallies([UNPRICED_ROW], "current"), []);

      expect(row.cost).toEqual({
        pricing: "unpriced",
        tokens: 12 * TOKENS_PER_LOOP,
        unpricedTokens: 12 * TOKENS_PER_LOOP,
        tokensPerSuccess: TOKENS_PER_LOOP,
      });
      expect(row.cost).not.toHaveProperty("cents");
      expect(row.cost).not.toHaveProperty("centsPerSuccess");
    });

    it("shows tokens when only part of the usage was priced — a partial dollar figure understates", () => {
      expect(costOf(tally({ tokens: 1000, unpricedTokens: 1, costCents: 50 })).pricing).toBe(
        "unpriced",
      );
    });

    it("divides priced spend by merges", () => {
      expect(costOf(tally({ merged: 4, costCents: 100 }))).toEqual({
        pricing: "priced",
        cents: 100,
        centsPerSuccess: 25,
      });
    });

    it("says none for a row with no usage recorded", () => {
      expect(costOf(tally({ tokens: 0, unpricedTokens: 0, costCents: null }))).toEqual({
        pricing: "none",
      });
    });
  });

  describe("the trend", () => {
    it.each([
      [84, 80, "up", 4],
      [61, 70, "down", -9],
      [96, 96, "flat", 0],
      [50, null, "flat", null],
      [null, 50, "flat", null],
    ] as const)("%s against %s is %s", (current, prior, direction, delta) => {
      expect(trendOf(current, prior)).toEqual({ direction, prior, delta });
    });

    it("compares a row with the same row only — task kind, model and hop", () => {
      const [primary, fallback] = composeRows(
        [tally({ hop: 1, merged: 10, untouched: 9 }), tally({ hop: 2, merged: 10, untouched: 5 })],
        [tally({ hop: 2, merged: 10, untouched: 8 })],
      );

      expect(primary.trend).toEqual({ direction: "flat", prior: null, delta: null });
      expect(fallback.trend.direction).toBe("down");
      expect(fallback.trend.prior).toBe(80);
    });
  });

  describe("roles, keys and order", () => {
    it("calls hop 1 the primary and every later hop a fallback", () => {
      expect([1, 2, 3].map(roleOf)).toEqual(["primary", "fallback", "fallback"]);
    });

    it("keys a row by task kind, model and hop", () => {
      const key = keyOf({ taskKind: "implement", model: "m", hop: 1 });

      expect(keyOf({ taskKind: "implement", model: "m", hop: 2 })).not.toBe(key);
      expect(keyOf({ taskKind: "implement", model: "n", hop: 1 })).not.toBe(key);
      expect(keyOf({ taskKind: "implement", model: "m", hop: 1 })).toBe(key);
    });

    it("puts the busiest task kind first and a fallback under its primary", () => {
      const rows = composeRows(
        [
          tally({ taskKind: "review", merged: 30 }),
          tally({ taskKind: "implement", hop: 2, model: "b", merged: 20 }),
          tally({ taskKind: "implement", hop: 1, model: "a", merged: 15 }),
        ],
        [],
      );

      expect(rows.map((row) => `${row.taskKind}:${String(row.hop)}`)).toEqual([
        "implement:1",
        "implement:2",
        "review:1",
      ]);
    });

    it("answers no rate for no merges", () => {
      expect(untouchedRateOf(undefined)).toBeNull();
      expect(untouchedRateOf({ merged: 0, untouched: 0 })).toBeNull();
      expect(untouchedRateOf({ merged: 4, untouched: 3 })).toBe(75);
    });
  });
});
