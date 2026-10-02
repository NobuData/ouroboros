import { mockupFacts, flakyCase } from "../page/page.fixture";
import { insightsResource } from "../page/page.compose";
import { formatDelta, formatFigure, formatMoney, formatCompact } from "../page/page.format";
import {
  DIGEST_CONTENT_VERSION,
  MAX_FLAKY_MOVERS,
  NOTHING_TO_REPORT,
  assembleDigest,
} from "./digest.assembly";
import {
  emptyWeekFacts,
  fixedCase,
  idleCase,
  partlyPricedWeekFacts,
  risingCase,
  unpricedWeekFacts,
  weekDigest,
  weekFacts,
  weekPage,
  weekWindow,
  withWeekWindows,
  WEEK,
} from "./digest.fixture";

/** Every string in a value, however deep. */
function stringsOf(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsOf);
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(stringsOf);

  return [];
}

describe("the digest, assembled from the page (decision I9)", () => {
  it("says the week the roadmap's example says", () => {
    const digest = weekDigest();

    expect(digest.headline).toBe("27 PRs merged this week. 12 needed a human.");
    expect(
      digest.kpis.map((kpi) => `${kpi.label}: ${kpi.valueText} ${String(kpi.deltaText)}`),
    ).toEqual([
      "Autonomous merge rate: 92% ▲ 3pts",
      "Merged without human edits: 78% ▲ 3pts",
      "Median cycle: 14m 20s ▼ 2m",
      "Cost per merged PR: $4.37 ▼ $0.41",
      "Human interventions: 12 ▲ 3",
    ]);
    expect(digest.topCause?.text).toBe("Flaky env / rig — 8 of 12 interventions.");
    expect(digest.cost.text).toBe("$118 this week across 31M tokens.");
    expect(digest.contentVersion).toBe(DIGEST_CONTENT_VERSION);
    expect(digest.empty).toBe(false);
  });

  it("carries every figure exactly as the page answered it — nothing is re-derived", () => {
    const page = weekPage();
    const digest = assembleDigest(page);

    expect(digest.window).toEqual(page.window);
    expect(digest.window).toEqual({ from: WEEK[0], to: WEEK[6] });
    expect(digest.head).toEqual({
      mergedPrs: page.head.mergedPrs,
      interventions: page.head.interventions,
    });

    for (const [index, kpi] of page.kpis.entries()) {
      expect(digest.kpis[index]).toMatchObject({
        key: kpi.key,
        unit: kpi.unit,
        value: kpi.value,
        delta: kpi.delta,
        good: kpi.trend.good,
        proxy: kpi.methodology.proxy,
        // Printed by the page's own printers, from the page's own numbers.
        valueText: formatFigure(kpi.value, kpi.unit),
        deltaText: formatDelta(kpi.delta, kpi.unit),
      });
    }

    const top = page.hbars.interventions.bars[0];
    expect(digest.topCause).toMatchObject({
      key: top.key,
      label: top.label,
      count: top.value,
      total: page.hbars.interventions.total,
      // The page's computed insight line, verbatim.
      line: page.hbars.interventions.line,
    });
    expect(digest.cost).toMatchObject({
      pricing: page.usage.pricing,
      tokens: page.usage.tokens,
      unpricedTokens: page.usage.unpricedTokens,
      costCents: page.usage.costCents,
    });
  });

  it("recomputes nothing when the page's figures move: the digest moves with them", () => {
    const moved = withWeekWindows(
      weekFacts(),
      weekWindow("merge_rate", {
        value: 80,
        prior: 90,
        unit: "pct",
        aggregation: "ratio",
        fill: null,
      }),
    );
    const [mergeRate] = weekDigest(moved).kpis;

    expect(mergeRate).toMatchObject({ valueText: "80%", deltaText: "▼ 10pts", good: false });
  });

  it("refuses any page but the seven-day one — a month is not 'this week'", () => {
    expect(() => assembleDigest(insightsResource(mockupFacts()))).toThrow(
      "A weekly digest is assembled from the 7d page, not 30d.",
    );
  });

  it("is plain JSON, so a run can store it and render every retry from the stored copy", () => {
    const digest = weekDigest();

    expect(JSON.parse(JSON.stringify(digest))).toEqual(digest);
  });
});

describe("the money rule, inherited (decision I8)", () => {
  it("prints dollars for priced usage", () => {
    const { cost, kpis } = weekDigest();

    expect(cost).toMatchObject({ pricing: "priced", costCents: 11_800 });
    expect(kpis[3]).toMatchObject({ label: "Cost per merged PR", unit: "cents" });
  });

  it("gives an unpriced workspace a token-only cost line and no dollar figure anywhere", () => {
    const digest = weekDigest(unpricedWeekFacts());

    expect(digest.cost.pricing).toBe("unpriced");
    expect(digest.cost).not.toHaveProperty("costCents");
    expect(digest.cost.text).toBe(
      "31M tokens this week. No price is configured for this usage, so there is no dollar figure.",
    );
    // The fourth card arrives from the page in tokens, and is named for what it now counts.
    expect(digest.kpis[3]).toMatchObject({
      label: "Tokens per merged PR",
      unit: "tokens",
      valueText: "1.1M",
    });
    expect(stringsOf(digest).filter((text) => text.includes("$"))).toEqual([]);
  });

  it("says what a partly priced figure leaves out", () => {
    const { cost } = weekDigest(partlyPricedWeekFacts());

    expect(cost).toMatchObject({ pricing: "priced", unpricedTokens: 7_750_000 });
    expect(cost.text).toBe(
      `${formatMoney(11_800)} this week for priced usage only — ` +
        `${formatCompact(7_750_000)} of ${formatCompact(31_000_000)} tokens have no price.`,
    );
  });

  it("says there was no usage rather than $0 when nothing ran a model", () => {
    const facts = withWeekWindows(
      weekFacts(),
      weekWindow("tokens", { unit: "tokens" }),
      weekWindow("cost_cents", { unit: "cents" }),
    );
    const { cost } = weekDigest(facts);

    expect(cost.pricing).toBe("none");
    expect(cost.text).toBe("No model usage this week.");
    expect(cost).not.toHaveProperty("costCents");
  });
});

describe("the proxy flag, inherited", () => {
  it("marks a KPI the registry calls a stand-in, and no other", () => {
    const facts = withWeekWindows(
      weekFacts(),
      weekWindow("cycle_time", {
        value: 860_000,
        prior: 980_000,
        unit: "duration_ms",
        aggregation: "median",
        proxy: true,
        fill: null,
      }),
    );

    expect(weekDigest(facts).kpis.map((kpi) => kpi.proxy)).toEqual([
      false,
      false,
      true,
      false,
      false,
    ]);
    expect(weekDigest().kpis.some((kpi) => kpi.proxy)).toBe(false);
  });
});

describe("the top intervention cause", () => {
  it("is null when no loop needed a human — there is no cause to name", () => {
    const facts = weekFacts({ breakdowns: emptyWeekFacts().breakdowns });

    expect(weekDigest(facts).topCause).toBeNull();
  });

  it("counts one intervention in the singular", () => {
    const one = emptyWeekFacts();
    const facts = weekFacts({
      breakdowns: {
        ...one.breakdowns,
        interventions: {
          ...weekFacts().breakdowns.interventions,
          entries: weekFacts().breakdowns.interventions.entries.filter(
            (entry) => entry.dimension === "policy_gate",
          ),
        },
      },
    });

    expect(weekDigest(facts).topCause?.text).toBe("Policy gate — 1 of 1 intervention.");
  });
});

describe("flaky movers", () => {
  it("lists a case that was fixed and one whose rate moved, and not one that sat still", () => {
    const movers = weekDigest().flaky;

    expect(movers.map((mover) => [mover.name, mover.text])).toEqual([
      ["tests/hil/test_estop_release.py", "fixed by loop #1847 · 8% flaky, falling"],
      ["ring buffer drains under burst", "watching · 25% flaky, rising on qemu_cortex_m3"],
    ]);
  });

  it("claims no fixing loop and no platform the page did not name", () => {
    const facts = weekFacts({
      flaky: [
        { ...fixedCase(), resolvedBy: null },
        { ...risingCase(), platform: null },
      ],
    });

    expect(weekDigest(facts).flaky.map((mover) => mover.text)).toEqual([
      "fixed · 8% flaky, falling",
      "watching · 25% flaky, rising",
    ]);
  });

  it("names a case the report never named by its suite", () => {
    const facts = weekFacts({ flaky: [{ ...risingCase(), name: null }] });

    expect(weekDigest(facts).flaky[0].name).toBe("telemetry integration");
  });

  it(`lists at most ${String(MAX_FLAKY_MOVERS)}, in the page's order`, () => {
    const many = Array.from({ length: MAX_FLAKY_MOVERS + 3 }, (_, index) => ({
      ...risingCase(),
      caseKey: String(index).padStart(64, "0"),
      name: `case ${String(index)}`,
    }));

    expect(weekDigest(weekFacts({ flaky: many })).flaky.map((mover) => mover.name)).toEqual(
      many.slice(0, MAX_FLAKY_MOVERS).map((flaky) => flaky.name),
    );
  });
});

describe("a week with nothing in it", () => {
  it("says so, rather than printing a page of zeroes", () => {
    const digest = weekDigest(emptyWeekFacts());

    expect(digest.empty).toBe(true);
    expect(digest.headline).toBe(NOTHING_TO_REPORT);
    expect(digest.topCause).toBeNull();
    expect(digest.flaky).toEqual([]);
    expect(digest.cost.pricing).toBe("none");
  });

  it("is not kept from being sent by a long-quarantined case that did not run", () => {
    expect(emptyWeekFacts().flaky).toEqual([idleCase()]);
    expect(weekDigest(emptyWeekFacts()).empty).toBe(true);
  });

  it.each([
    ["a merge", weekWindow("merged_prs", { value: 1 }), "week"],
    ["an intervention", weekWindow("human_interventions", { value: 1 }), "week"],
    ["a build", weekWindow("builds", { value: 1 }), "windows"],
    ["a test run", weekWindow("test_cases_run", { value: 40 }), "windows"],
    ["model usage", weekWindow("tokens", { value: 900, unit: "tokens" }), "windows"],
    [
      "a PR closed unmerged",
      weekWindow("merge_rate", { value: 0, prior: null, unit: "pct", aggregation: "ratio" }),
      "windows",
    ],
  ] as const)("is not empty when the week had %s", (_what, window, where) => {
    const empty = emptyWeekFacts();
    const facts = {
      ...empty,
      [where]: new Map([...empty[where], [window.metricId, window]]),
    };

    expect(weekDigest(facts).empty).toBe(false);
  });

  it("is not empty when a flaky case ran or was fixed this week", () => {
    expect(weekDigest({ ...emptyWeekFacts(), flaky: [risingCase()] }).empty).toBe(false);
    expect(weekDigest({ ...emptyWeekFacts(), flaky: [fixedCase()] }).empty).toBe(false);
    expect(
      weekDigest({
        ...emptyWeekFacts(),
        flaky: [flakyCase({ observed: 0, flaky: 0, history: [] })],
      }).empty,
    ).toBe(true);
  });
});

describe("the headline", () => {
  it.each([
    [1, 0, "1 PR merged this week. None needed a human."],
    [0, 2, "No PRs merged this week. 2 needed a human."],
    [1_204, 1, "1,204 PRs merged this week. 1 needed a human."],
  ])("reads %i merged and %i interventions as %p", (merged, interventions, expected) => {
    const facts = weekFacts({
      week: new Map([
        ["merged_prs", weekWindow("merged_prs", { value: merged })],
        ["human_interventions", weekWindow("human_interventions", { value: interventions })],
      ]),
    });

    expect(weekDigest(facts).headline).toBe(expected);
  });
});
