/**
 * The bar cards and their insight lines. Each line is asserted twice: once against mockup 15's
 * own sentence, and once after the data under it moved — a line that was typed would pass the
 * first and fail the second.
 */

import { barCards, breakdownOf, pageWindow, mockupBreakdowns, mockupWindows } from "./page.fixture";
import {
  barCardsOf,
  effortCard,
  interventionsCard,
  stagesCard,
  suitesCard,
  tokensCard,
} from "./page.hbars";

describe("where loops still need humans", () => {
  it("draws the five causes largest first, named as the card names them", () => {
    const card = interventionsCard(mockupBreakdowns().interventions);

    expect(card.bars.map((bar) => [bar.key, bar.label, bar.value])).toEqual([
      ["infra_rig", "Flaky env / rig", 8],
      ["ambiguous_ticket", "Ambiguous ticket", 5],
      ["policy_gate", "Policy gate", 4],
      ["model_disagreement", "Model disagreement", 2],
      ["other", "Other", 1],
    ]);
    expect(card.total).toBe(20);
    expect(card.line).toBe("Fix the top row and interventions drop ~40%.");
    expect(card.methodology.metricId).toBe("human_interventions");
  });

  it("recomputes the line when the causes change", () => {
    const card = interventionsCard(
      breakdownOf("human_interventions", "cause", [
        ["infra_rig", 3],
        ["ambiguous_ticket", 9],
      ]),
    );

    expect(card.bars.map((bar) => bar.label)).toEqual(["Ambiguous ticket", "Flaky env / rig"]);
    expect(card.line).toBe("Fix the top row and interventions drop ~75%.");
  });

  it("draws no bar for a cause that went quiet, and says nothing about an empty window", () => {
    const quiet = interventionsCard(
      breakdownOf("human_interventions", "cause", [
        ["infra_rig", 0, 4],
        ["other", 2],
      ]),
    );
    const empty = interventionsCard(breakdownOf("human_interventions", "cause", []));

    expect(quiet.bars.map((bar) => bar.key)).toEqual(["other"]);
    expect(quiet.line).toBe("Fix the top row and interventions drop ~100%.");
    expect(empty).toMatchObject({ bars: [], total: 0, line: null });
  });

  it("labels a cause it has no name for by its key, rather than dropping it", () => {
    const card = interventionsCard(
      breakdownOf("human_interventions", "cause", [["vendor_outage", 2]]),
    );

    expect(card.bars).toEqual([{ key: "vendor_outage", label: "Vendor_outage", value: 2 }]);
  });
});

describe("cycle time by stage", () => {
  it("draws the stages in loop order, with the loop's self-review as Verify", () => {
    const card = stagesCard(mockupBreakdowns().stages);

    expect(card.bars.map((bar) => [bar.label, bar.value])).toEqual([
      ["Analyze", 60_000],
      ["Plan", 120_000],
      ["Implement", 364_000],
      ["Build", 120_000],
      ["Test", 160_000],
      ["Verify", 40_000],
    ]);
    // Medians do not add up to a median.
    expect(card.total).toBeNull();
    expect(card.line).toBe("Implement dominates the loop — the other five stages sum to 8m 20s.");
  });

  it("recomputes the line when the medians change", () => {
    const card = stagesCard(
      breakdownOf(
        "stage_duration",
        "stage",
        [
          ["plan", 90_000],
          ["implement", 200_000],
          ["test", 600_000],
        ],
        { unit: "duration_ms", aggregation: "median" },
      ),
    );

    expect(card.line).toBe("Test dominates the loop — the other two stages sum to 4m 50s.");
  });

  it("speaks of one other stage in the singular, and of a lone stage not at all", () => {
    const two = stagesCard(
      breakdownOf("stage_duration", "stage", [
        ["implement", 300_000],
        ["test", 45_000],
      ]),
    );
    const one = stagesCard(breakdownOf("stage_duration", "stage", [["implement", 300_000]]));

    expect(two.line).toBe("Implement dominates the loop — the other stage takes 45s.");
    expect(one.line).toBeNull();
  });

  it("sorts a stage it does not know after the ones it does", () => {
    const card = stagesCard(
      breakdownOf("stage_duration", "stage", [
        ["deploy", 10_000],
        ["test", 20_000],
        ["analyze", 5_000],
      ]),
    );

    expect(card.bars.map((bar) => bar.key)).toEqual(["analyze", "test", "deploy"]);
  });
});

describe("test failures by suite", () => {
  it("draws the suites largest first and computes their share of everything that ran", () => {
    const card = suitesCard(mockupBreakdowns().suites, 26_430);

    expect(card.bars.map((bar) => [bar.label, bar.value])).toEqual([
      ["telemetry integration", 14],
      ["PHYSICAL · HIL rig", 10],
      ["OTA update", 5],
      ["motor control", 3],
      ["unit · drivers", 1],
    ]);
    expect(card.total).toBe(33);
    expect(card.line).toBe("33 failing cases total — 0.12% of everything that ran.");
  });

  it("recomputes the line when the failures or the cases run change", () => {
    const suites = breakdownOf("test_failures_by_suite", "suite", [["OTA update", 1]]);

    expect(suitesCard(suites, 50).line).toBe("1 failing case total — 2% of everything that ran.");
    expect(suitesCard(mockupBreakdowns().suites, 3_300).line).toBe(
      "33 failing cases total — 1% of everything that ran.",
    );
  });

  it("says nothing with no failures, or with no count of what ran", () => {
    expect(suitesCard(breakdownOf("test_failures_by_suite", "suite", []), 26_430).line).toBeNull();
    expect(suitesCard(mockupBreakdowns().suites, null).line).toBeNull();
    expect(suitesCard(mockupBreakdowns().suites, 0).line).toBeNull();
  });
});

describe("time to completion by effort", () => {
  it("draws XS to XL in size order and carries the estimator's calibration", () => {
    const card = effortCard(mockupBreakdowns().effort, { withinBandPct: (100 * 8) / 9 });

    expect(card.bars.map((bar) => [bar.label, bar.value])).toEqual([
      ["XS", 360_000],
      ["S", 660_000],
      ["M", 1_140_000],
      ["L", 2_880_000],
      ["XL", 7_800_000],
    ]);
    expect(card.line).toBe(
      "Estimator calibration: 89% of issues land within their predicted band.",
    );
  });

  it("recomputes the line from the calibration, and omits it when nothing was graded", () => {
    const { effort } = mockupBreakdowns();

    expect(effortCard(effort, { withinBandPct: 50 }).line).toBe(
      "Estimator calibration: 50% of issues land within their predicted band.",
    );
    expect(effortCard(effort, { withinBandPct: null }).line).toBeNull();
  });
});

describe("tokens by stage", () => {
  it("draws the task kinds largest first under the window's whole total", () => {
    const card = tokensCard(mockupBreakdowns().tokens, mockupWindows());

    expect(card.bars.map((bar) => [bar.label, bar.value / 1_000_000])).toEqual([
      ["implement", 71],
      ["review", 18],
      ["plan", 14],
      ["analyze", 12],
      ["test-gen", 8],
      ["docs", 3],
    ]);
    expect(card.total).toBe(126_000_000);
    // 126M over the window's 97 merges; 39.06M of them local.
    expect(card.line).toBe("≈ 1.3M tokens per merged PR · 31% served by local models.");
  });

  it("recomputes both halves of the line when merges or the local share change", () => {
    const windows = mockupWindows();

    windows.set("merged_prs", pageWindow("merged_prs", { value: 27 }));
    windows.set("local_tokens", pageWindow("local_tokens", { value: 63_000_000 }));

    expect(tokensCard(mockupBreakdowns().tokens, windows).line).toBe(
      "≈ 4.7M tokens per merged PR · 50% served by local models.",
    );
  });

  it("keeps only the half it can compute", () => {
    const noMerges = mockupWindows();
    const noLocal = mockupWindows();
    const neither = mockupWindows();

    noMerges.set("merged_prs", pageWindow("merged_prs", { value: 0 }));
    noLocal.set("local_tokens", pageWindow("local_tokens", { value: 0 }));
    neither.set("tokens", pageWindow("tokens", { value: 0 }));

    expect(tokensCard(mockupBreakdowns().tokens, noMerges).line).toBe(
      "31% served by local models.",
    );
    expect(tokensCard(mockupBreakdowns().tokens, noLocal).line).toBe(
      "≈ 1.3M tokens per merged PR.",
    );
    expect(tokensCard(mockupBreakdowns().tokens, neither).line).toBeNull();
  });

  it("keeps the total above the bars when some usage named no task kind", () => {
    const card = tokensCard(
      breakdownOf("tokens_by_task_kind", "task_kind", [["implement", 100]], { unit: "tokens" }),
      mockupWindows(),
    );

    expect(card.total).toBe(126_000_000);
    expect(card.bars).toEqual([{ key: "implement", label: "implement", value: 100 }]);
  });
});

describe("the five cards together", () => {
  it("reads the suites' share from the range's cases run", () => {
    const cards = barCardsOf(mockupBreakdowns(), mockupWindows(), { withinBandPct: 89 });

    expect(Object.keys(cards)).toEqual(["interventions", "stages", "suites", "effort", "tokens"]);
    expect(cards.suites.line).toContain("0.12%");
    expect(barCards(cards).every((card) => card.line !== null)).toBe(true);
  });
});
