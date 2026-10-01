import { MOCKUP_15_SCOREBOARD, mockupTallies } from "../../../testing/scoreboard.fixture";
import type { MetricDefinition, MetricsRepository } from "../metrics/metrics.repository";
import { SCOREBOARD_MIN_SAMPLE } from "./scoreboard.compose";
import type { ScoreboardRepository } from "./scoreboard.repository";
import {
  instantsOf,
  SCOREBOARD_METRICS,
  ScoreboardRegistryError,
  ScoreboardService,
} from "./scoreboard.service";
import type { ScoreboardSuggestionSource } from "./scoreboard.types";

/**
 * The scoreboard service (BJ.3, #439): windows of equal length, a methodology for every column,
 * and the AB.3 suggestion slot's honesty both ways.
 */

const ORG = "org-scoreboard";
const NOW = new Date("2026-10-01T15:30:00.000Z");

/**
 * A registry entry.
 *
 * @param metricId - Its id.
 * @param unit - Its unit.
 * @returns The entry.
 */
function definition(metricId: string, unit: MetricDefinition["unit"]): MetricDefinition {
  return {
    metricId,
    family: metricId === "merged_untouched_rate" ? "throughput" : "scoreboard",
    title: `Title of ${metricId}`,
    formulaText: `Formula of ${metricId}`,
    sourcePlanes: ["pull_requests"],
    caveats: `Caveats of ${metricId}`,
    unit,
    isRate: unit === "pct",
    version: 1,
    proxy: false,
    aggregation: unit === "pct" ? "ratio" : "sum",
    dimensionKind: null,
  };
}

/** The registry as V076 and V082 ship it, for the four columns. */
const REGISTRY = new Map(
  [
    definition("merged_untouched_rate", "pct"),
    definition("scoreboard_cost_per_success", "cents"),
    definition("scoreboard_trend", "pct"),
    definition("scoreboard_merged", "count"),
  ].map((entry) => [entry.metricId, entry]),
);

describe("the scoreboard service", () => {
  let tallies: jest.Mock;
  let definitions: jest.Mock;

  /**
   * The service over stubbed statements.
   *
   * @param suggestions - AB.3's source, or undefined for none bound.
   * @returns The service.
   */
  function service(suggestions?: ScoreboardSuggestionSource): ScoreboardService {
    return new ScoreboardService(
      { tallies } as unknown as ScoreboardRepository,
      { definitions } as unknown as MetricsRepository,
      suggestions,
      () => NOW.getTime(),
    );
  }

  beforeEach(() => {
    tallies = jest
      .fn()
      .mockResolvedValueOnce(mockupTallies(MOCKUP_15_SCOREBOARD, "current"))
      .mockResolvedValueOnce(mockupTallies(MOCKUP_15_SCOREBOARD, "prior"));
    definitions = jest.fn().mockResolvedValue(REGISTRY);
  });

  describe("the windows", () => {
    it("compares the range with the prior window of equal length, both by UTC day", async () => {
      const board = await service().scoreboard({ organizationId: ORG, range: "30d" });

      expect(board.window).toEqual({ from: "2026-09-02", to: "2026-10-01" });
      expect(board.prior).toEqual({ from: "2026-08-03", to: "2026-09-01" });
      expect(tallies).toHaveBeenNthCalledWith(
        1,
        ORG,
        {
          from: new Date("2026-09-02T00:00:00.000Z"),
          to: new Date("2026-10-02T00:00:00.000Z"),
        },
        undefined,
      );
      expect(tallies).toHaveBeenNthCalledWith(
        2,
        ORG,
        {
          from: new Date("2026-08-03T00:00:00.000Z"),
          to: new Date("2026-09-02T00:00:00.000Z"),
        },
        undefined,
      );
    });

    it.each(["7d", "30d", "90d"] as const)(
      "gives %s and its prior window the same number of instants",
      async (range) => {
        await service().scoreboard({ organizationId: ORG, range, now: NOW });

        const [[, current], [, prior]] = tallies.mock.calls as [
          unknown,
          { from: Date; to: Date },
        ][];

        expect(current.to.getTime() - current.from.getTime()).toBe(
          prior.to.getTime() - prior.from.getTime(),
        );
        expect(prior.to).toEqual(current.from);
      },
    );

    it("passes the repository filter to both windows", async () => {
      await service().scoreboard({ organizationId: ORG, range: "7d", repo: "acme/helios" });

      expect(tallies.mock.calls.map((call: unknown[]) => call[2])).toEqual([
        "acme/helios",
        "acme/helios",
      ]);
    });

    it("turns a span of days into [start of the first, start of the day after the last)", () => {
      expect(instantsOf({ from: "2024-02-28", to: "2024-02-29" })).toEqual({
        from: new Date("2024-02-28T00:00:00.000Z"),
        to: new Date("2024-03-01T00:00:00.000Z"),
      });
    });
  });

  describe("the rows", () => {
    it("are the mockup's, with the threshold they were badged against", async () => {
      const board = await service().scoreboard({ organizationId: ORG, range: "30d" });

      expect(board.minSample).toBe(SCOREBOARD_MIN_SAMPLE);
      expect(board.rows.map((row) => [row.taskKind, row.model, row.role])).toEqual([
        ["implement", "claude-fable-5", "primary"],
        ["implement", "copilot/gpt-5-codex", "fallback"],
        ["docs", "ollama/qwen3-coder", "primary"],
        ["review", "claude-fable-5", "primary"],
      ]);
    });
  });

  describe("the methodology", () => {
    it("gives every column a registry entry, and untouched is the KPI row's own", async () => {
      const board = await service().scoreboard({ organizationId: ORG, range: "30d" });

      expect(Object.keys(board.methodology).sort()).toEqual(Object.keys(SCOREBOARD_METRICS).sort());
      expect(board.methodology.untouched.metricId).toBe("merged_untouched_rate");
      expect(board.methodology.costPerSuccess).toMatchObject({
        metricId: "scoreboard_cost_per_success",
        unit: "cents",
        formula: "Formula of scoreboard_cost_per_success",
        caveats: "Caveats of scoreboard_cost_per_success",
      });
      expect(board.methodology.trend.metricId).toBe("scoreboard_trend");
      expect(board.methodology.sample.metricId).toBe("scoreboard_merged");
    });

    it("refuses to answer a column it cannot explain", async () => {
      const partial = new Map(REGISTRY);
      partial.delete("scoreboard_trend");
      definitions.mockResolvedValue(partial);

      await expect(service().scoreboard({ organizationId: ORG, range: "30d" })).rejects.toThrow(
        ScoreboardRegistryError,
      );
    });
  });

  describe("the suggestion slot (decision I10)", () => {
    it("is absent — the key itself — while AB.3 is not bound", async () => {
      const board = await service().scoreboard({ organizationId: ORG, range: "30d" });

      expect(board).not.toHaveProperty("suggestion");
    });

    it("passes AB.3's payload through untouched when AB.3 has one", async () => {
      const payload = {
        text: "fable stays primary; consider dropping fallback to ollama/qwen3-coder for XS issues",
        savingsCentsPerMonth: 1400,
        apply: { href: "/models" },
      };
      const suggestion = jest.fn().mockResolvedValue(payload);

      const board = await service({ suggestion }).scoreboard({
        organizationId: ORG,
        range: "30d",
      });

      expect(board.suggestion).toBe(payload);
      expect(suggestion).toHaveBeenCalledWith({ organizationId: ORG, range: "30d" }, board.rows);
    });

    it("is absent when AB.3 is bound but has nothing to say", async () => {
      const board = await service({ suggestion: jest.fn().mockResolvedValue(null) }).scoreboard({
        organizationId: ORG,
        range: "30d",
      });

      expect(board).not.toHaveProperty("suggestion");
    });
  });
});
