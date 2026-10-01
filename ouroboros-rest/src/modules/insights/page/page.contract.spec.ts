/**
 * What the page answers, held to what `openapi.yaml` promises (BJ.2,
 * [#438](https://github.com/NobuData/ouroboros/issues/438)).
 *
 * The composers' own suites prove the figures; this one proves the **shape** — that every state
 * the page can be in is a document the published `Insights` schema admits, and that the schema is
 * closed where the honesty gates need it to be: a claim with no source cannot be added to the
 * payload without the contract being changed first.
 */

import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import { document } from "../../../openapi/specification";
import type { ScoreboardRow } from "../scoreboard/scoreboard.types";
import { insightsResource } from "./page.compose";
import {
  barCards,
  breakdownOf,
  emptyScoreboard,
  flakyCase,
  mockupFacts,
  pageWindow,
  unpricedFacts,
  windowsOf,
} from "./page.fixture";

/**
 * A validator for one published schema.
 *
 * @param name - The schema's name under `components.schemas`.
 * @returns A function answering the violations, or undefined when the value conforms.
 */
function validatorFor(name: string): (value: unknown) => string | undefined {
  const id = "https://ouroboros.invalid/openapi.json";
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema({ $id: id, components: document().components });

  const validate = ajv.compile({ $ref: `${id}#/components/schemas/${name}` });
  return (value) => (validate(value) ? undefined : ajv.errorsText(validate.errors));
}

/** A value as it crosses the wire: `undefined` keys gone, nothing but JSON. */
function wire<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const violations = validatorFor("Insights");

/** A scoreboard row with one of the three cost shapes. */
function row(cost: ScoreboardRow["cost"], taskKind: string): ScoreboardRow {
  return {
    taskKind,
    model: "claude-fable-5",
    hop: 1,
    role: "primary",
    merged: 12,
    untouched: 10,
    untouchedRate: (100 * 10) / 12,
    cost,
    trend: { direction: "up", prior: 80, delta: 3.3 },
    lowSample: false,
  };
}

describe("the insights payload against its published schema", () => {
  it("admits the seeded page", () => {
    expect(violations(wire(insightsResource(mockupFacts())))).toBeUndefined();
  });

  it("admits a workspace nothing prices — tokens, and no dollar key", () => {
    expect(violations(wire(insightsResource(unpricedFacts())))).toBeUndefined();
  });

  it("admits a fixed flaky case naming its loop, and a case with no rig", () => {
    const resolvedBy = { runId: "5eed005f-0000-4000-8000-000000001847", issueNumber: 1847 };
    const page = insightsResource(
      mockupFacts({
        flaky: [
          flakyCase({ state: "fixed", resolvedBy, platform: null }),
          flakyCase({ caseKey: "b".repeat(64), state: "watching", name: null, suite: null }),
          flakyCase({ caseKey: "c".repeat(64), observed: 0, flaky: 0, history: [] }),
        ],
      }),
    );

    expect(violations(wire(page))).toBeUndefined();
  });

  it("admits a scoreboard row in each of its three cost shapes", () => {
    const scoreboard = {
      ...emptyScoreboard(),
      rows: [
        row({ pricing: "priced", cents: 1044, centsPerSuccess: 87 }, "implement"),
        row(
          { pricing: "unpriced", tokens: 9000, unpricedTokens: 400, tokensPerSuccess: 750 },
          "review",
        ),
        row({ pricing: "none" }, "docs"),
      ],
    };

    expect(violations(wire(insightsResource(mockupFacts({ scoreboard }))))).toBeUndefined();
  });

  it("admits a workspace with nothing in the window: nulls, empty cards, no lines", () => {
    const facts = mockupFacts();
    const empty = insightsResource({
      ...facts,
      repo: null,
      week: windowsOf(pageWindow("merged_prs"), pageWindow("human_interventions")),
      windows: new Map(
        [...facts.windows].map(([metricId, window]) => [
          metricId,
          pageWindow(metricId, {
            value: window.methodology.aggregation === "sum" ? 0 : null,
            prior: null,
            fill: window.methodology.aggregation === "sum" ? 0 : null,
            unit: window.methodology.unit,
            aggregation: window.methodology.aggregation,
            proxy: window.methodology.proxy,
          }),
        ]),
      ),
      breakdowns: {
        interventions: breakdownOf("human_interventions", "cause", []),
        stages: breakdownOf("stage_duration", "stage", []),
        suites: breakdownOf("test_failures_by_suite", "suite", []),
        effort: breakdownOf("completion_time_by_effort", "effort", []),
        tokens: breakdownOf("tokens_by_task_kind", "task_kind", []),
      },
      calibration: { withinBandPct: null },
      caps: { monthlyCapCents: null, connections: 0 },
      flaky: [],
    });

    expect(violations(wire(empty))).toBeUndefined();
    expect(barCards(empty.hbars).map((card) => card.line)).toEqual([null, null, null, null, null]);
    expect(empty.usage.pricing).toBe("none");
  });
});

describe("the schema is closed where the honesty gates need it", () => {
  const page = wire(insightsResource(mockupFacts()));

  it("refuses an alerts claim on the cost chart — #237 has to change the contract to add one", () => {
    const claimed = {
      ...page,
      series: { ...page.series, cost: { ...page.series.cost, alertsClaim: true } },
    };

    expect(violations(claimed)).toMatch(/must NOT have additional properties/);
  });

  it("refuses a cluster note on the builds chart", () => {
    const noted = {
      ...page,
      series: { ...page.series, builds: { ...page.series.builds, note: "deps-refresh days" } },
    };

    expect(violations(noted)).toMatch(/must NOT have additional properties/);
  });

  it("refuses a dollar figure the money rule does not know", () => {
    const priced = { ...page, usage: { ...page.usage, estimatedCostCents: 12 } };

    expect(violations(priced)).toMatch(/must NOT have additional properties/);
  });

  it("refuses a KPI row that is not the five cards, and a DORA strip without its proxy flag", () => {
    const short = { ...page, kpis: page.kpis.slice(0, 4) };
    const unflagged = {
      ...page,
      dora: page.dora.map(({ proxy: _proxy, ...cell }) => cell),
    };

    expect(violations(short)).toMatch(/must NOT have fewer than 5 items/);
    expect(violations(unflagged)).toMatch(/must have required property 'proxy'/);
  });
});
