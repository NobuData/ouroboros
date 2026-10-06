import {
  CALIBRATION_VERSION,
  DEFAULT_TOOL_OPERATIONS_PER_ROUND,
  DEPTH_PRESETS,
  TOOL_OPERATIONS_PER_ROUND,
} from "./estimate.calibration";
import {
  type EstimateInput,
  estimateInvestigation,
  renderCost,
  renderEstimateLabel,
  renderRange,
  scaledRate,
  sourceRange,
  toolOperations,
} from "./estimate";

/**
 * The estimator, as arithmetic — CM.3 (#622), decision V5.
 *
 * The acceptance figure is asserted first and exactly: mockup 22's composer reads
 * `est. 40–60 sources · ~$6` for a deep dive over five tools with the seeded researcher at
 * `$3 · $15` per 1M, and that line must fall out of the calibration rather than be typed.
 */

/** The seeded deep dive's five tools — RS-127's selection. */
const FIVE_TOOLS = ["web", "competitor", "code", "tickets", "telemetry"] as const;

/** `researcher-long-ctx` → `claude-sonnet-4-6`, as the catalog prices it. */
const SONNET_RATES = { inputCentsPer1m: "300.0000", outputCentsPer1m: "1500.0000" };

/** The seeded composer's inputs. */
const SEEDED: EstimateInput = {
  depth: "deep_dive",
  tools: FIVE_TOOLS,
  synthesisRates: SONNET_RATES,
  toolOperationCents: new Map(),
};

describe("the research estimate", () => {
  describe("the seeded deep dive", () => {
    it("reproduces mockup 22's `est. 40–60 sources · ~$6` exactly", () => {
      const estimate = estimateInvestigation(SEEDED);

      expect(estimate.sources).toEqual({ min: 40, max: 60 });
      expect(renderEstimateLabel(estimate)).toBe("est. 40–60 sources · ~$6");
    });

    it("prices it at 522–687¢ — 40 or 60 digests at 8.25¢ and four 48¢ synthesis passes", () => {
      // These are the figures R__dev_seed_research.sql stores on RS-127; the seed and the
      // estimator must not disagree about what the calibration says.
      expect(estimateInvestigation(SEEDED).costCents).toEqual({ min: 522, max: 687 });
    });

    it("plans 40 operations, split by tool in selection order", () => {
      const { operations } = estimateInvestigation(SEEDED);

      expect(operations.total).toBe(40);
      expect(operations.byTool).toEqual([
        { tool: "web", operations: 12, hostedCostCents: null },
        { tool: "competitor", operations: 8, hostedCostCents: null },
        { tool: "code", operations: 8, hostedCostCents: null },
        { tool: "tickets", operations: 8, hostedCostCents: null },
        { tool: "telemetry", operations: 4, hostedCostCents: null },
      ]);
    });

    it("plans one synthesis call per source plus the depth's passes", () => {
      expect(estimateInvestigation(SEEDED).synthesisCalls).toEqual({ min: 44, max: 64 });
    });

    it("says which calibration computed it", () => {
      expect(estimateInvestigation(SEEDED).calibrationVersion).toBe(CALIBRATION_VERSION);
    });

    it("is deterministic", () => {
      expect(estimateInvestigation(SEEDED)).toEqual(estimateInvestigation(SEEDED));
    });
  });

  describe("moving with the composer", () => {
    it("narrows the source range when a tool is disabled", () => {
      const all = estimateInvestigation(SEEDED);
      const fewer = estimateInvestigation({
        ...SEEDED,
        tools: ["competitor", "code", "tickets", "telemetry"],
      });

      expect(fewer.sources.max - fewer.sources.min).toBeLessThan(all.sources.max - all.sources.min);
      expect(fewer.sources.max).toBeLessThan(all.sources.max);
      expect(fewer.sources).toEqual({ min: 28, max: 42 });
    });

    it("narrows with every tool removed, down to one", () => {
      const widths = [5, 4, 3, 2, 1].map((count) => {
        const { sources } = estimateInvestigation({ ...SEEDED, tools: FIVE_TOOLS.slice(0, count) });
        return sources.max - sources.min;
      });

      expect(widths).toEqual([...widths].sort((a, b) => b - a));
      expect(new Set(widths).size).toBe(widths.length);
    });

    it("lowers the cost when a tool is disabled", () => {
      const all = estimateInvestigation(SEEDED).costCents!;
      const fewer = estimateInvestigation({ ...SEEDED, tools: ["web"] }).costCents!;

      expect(fewer.max).toBeLessThan(all.max);
    });

    it("rises from quick to standard to deep dive, in sources and in cost", () => {
      const [quick, standard, deep] = (["quick", "standard", "deep_dive"] as const).map((depth) =>
        estimateInvestigation({ ...SEEDED, depth }),
      );

      expect(quick.sources).toEqual({ min: 10, max: 15 });
      expect(standard.sources).toEqual({ min: 20, max: 30 });
      expect(deep.sources).toEqual({ min: 40, max: 60 });
      expect(quick.costCents!.max).toBeLessThan(standard.costCents!.min);
      expect(standard.costCents!.max).toBeLessThan(deep.costCents!.min);
    });

    it("moves with the alias's price", () => {
      const cheaper = estimateInvestigation({
        ...SEEDED,
        synthesisRates: { inputCentsPer1m: "200.0000", outputCentsPer1m: "1000.0000" },
      });

      expect(cheaper.costCents).toEqual({ min: 348, max: 458 });
      expect(cheaper.sources).toEqual({ min: 40, max: 60 });
    });
  });

  describe("the honesty rule", () => {
    it("gives a source range and no cost for an unpriced alias", () => {
      const estimate = estimateInvestigation({ ...SEEDED, synthesisRates: null });

      expect(estimate.sources).toEqual({ min: 40, max: 60 });
      expect(estimate.costCents).toBeNull();
    });

    it("puts no dollar figure anywhere — not even a hosted tool's", () => {
      const estimate = estimateInvestigation({
        ...SEEDED,
        synthesisRates: null,
        toolOperationCents: new Map([["web", 2]]),
      });

      expect(estimate.costCents).toBeNull();
      expect(estimate.operations.byTool.every((tool) => tool.hostedCostCents === null)).toBe(true);
      expect(renderEstimateLabel(estimate)).toBe("est. 40–60 sources");
      expect(JSON.stringify({ ...estimate, label: renderEstimateLabel(estimate) })).not.toContain(
        "$",
      );
    });

    it("prices a free model at a real zero, never as unpriced", () => {
      const estimate = estimateInvestigation({
        ...SEEDED,
        synthesisRates: { inputCentsPer1m: 0, outputCentsPer1m: 0 },
      });

      expect(estimate.costCents).toEqual({ min: 0, max: 0 });
      expect(renderEstimateLabel(estimate)).toBe("est. 40–60 sources · $0");
    });
  });

  describe("hosted tool operations", () => {
    it("adds a hosted provider's per-operation price to both ends", () => {
      // Twelve web operations at 2.5¢ each — 30¢ on top of the model calls.
      const estimate = estimateInvestigation({
        ...SEEDED,
        toolOperationCents: new Map([["web", 2.5]]),
      });

      expect(estimate.costCents).toEqual({ min: 552, max: 717 });
      expect(estimate.operations.byTool[0]).toEqual({
        tool: "web",
        operations: 12,
        hostedCostCents: 30,
      });
    });

    it("ignores a price for a tool that is not selected", () => {
      const estimate = estimateInvestigation({
        ...SEEDED,
        toolOperationCents: new Map([["docs", 50]]),
      });

      expect(estimate.costCents).toEqual({ min: 522, max: 687 });
    });

    it("treats a zero price as no hosted charge", () => {
      const estimate = estimateInvestigation({
        ...SEEDED,
        toolOperationCents: new Map([["web", 0]]),
      });

      expect(estimate.operations.byTool[0].hostedCostCents).toBeNull();
      expect(estimate.costCents).toEqual({ min: 522, max: 687 });
    });
  });

  describe("refusals", () => {
    it("refuses an empty tool selection", () => {
      expect(() => estimateInvestigation({ ...SEEDED, tools: [] })).toThrow(RangeError);
    });

    it("refuses a repeated tool", () => {
      expect(() => estimateInvestigation({ ...SEEDED, tools: ["web", "web"] })).toThrow(
        /repeats a slug/,
      );
    });

    it("refuses a malformed rate", () => {
      expect(() =>
        estimateInvestigation({
          ...SEEDED,
          synthesisRates: { inputCentsPer1m: "-1", outputCentsPer1m: "1" },
        }),
      ).toThrow(RangeError);
    });
  });
});

describe("the estimate's building blocks", () => {
  it("parses rates exactly, to four places", () => {
    expect(scaledRate("300.0000")).toBe(3_000_000n);
    expect(scaledRate("0.25")).toBe(2_500n);
    expect(scaledRate(15)).toBe(150_000n);
    expect(scaledRate(" 1.5 ")).toBe(15_000n);
  });

  it.each(["", "abc", "1.23456", "-3", "1e-7"])("refuses %p as a rate", (value) => {
    expect(() => scaledRate(value)).toThrow(RangeError);
  });

  it("plans a tool's per-round operations once per round", () => {
    expect(toolOperations("web", "deep_dive")).toBe(
      TOOL_OPERATIONS_PER_ROUND.web * DEPTH_PRESETS.deep_dive.rounds,
    );
  });

  it("gives a registered tool the calibration has not met the default per-round count", () => {
    expect(toolOperations("patents", "standard")).toBe(
      DEFAULT_TOOL_OPERATIONS_PER_ROUND * DEPTH_PRESETS.standard.rounds,
    );
  });

  it("rounds the source range outward", () => {
    expect(sourceRange(3)).toEqual({ min: 3, max: 5 });
    expect(sourceRange(40)).toEqual({ min: 40, max: 60 });
  });

  it("renders a range with an en dash, and one number when both ends agree", () => {
    expect(renderRange({ min: 40, max: 60 })).toBe("40–60");
    expect(renderRange({ min: 7, max: 7 })).toBe("7");
  });

  it.each([
    [{ min: 522, max: 687 }, "~$6"],
    [{ min: 0, max: 0 }, "$0"],
    [{ min: 10, max: 40 }, "<$1"],
    [{ min: 100, max: 200 }, "~$2"],
  ])("renders %p as %p", (cost, text) => {
    expect(renderCost(cost)).toBe(text);
  });
});
