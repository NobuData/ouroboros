import { describe, expect, it } from "vitest";

import {
  DORA_CAPTION,
  DORA_NOT_ENOUGH,
  DORA_TITLE,
  SPARK_BARS,
  doraCell,
  doraStrip,
  sparklineOf,
} from "@/app/insights/dora-view";
import { NOT_MEASURED, PROXY_BADGE } from "@/app/insights/view";

import { doraCell as cell, seededDora, seededInsights } from "../helpers/insights";

/**
 * The DORA strip's decisions (#447): the mockup's figures and lines, the proxy flag carried to
 * the cell, and no curve invented where nothing was measured.
 */

describe("the DORA strip's copy", () => {
  it("is the mockup's, verbatim", () => {
    expect(DORA_TITLE).toBe("Delivery health · DORA-ish");
    expect(DORA_CAPTION).toBe("Computed from your GitHub + build farm events, not self-reported.");
  });
});

describe("doraStrip", () => {
  it("draws the seeded strip as the mockup does — 4.2/day ▲, 3h 10m ▼, 3.1% —, 22m ▼", () => {
    const cells = doraStrip(seededInsights());

    expect(cells.map((view) => [view.label, view.value, view.valueSuffix, view.delta, view.tone])).toEqual([
      ["Deploy frequency", "4.2", "/day", "▲ 0.4/day vs prior 30d", "up"],
      ["Lead time · issue→merge", "3h 10m", null, "▼ 20m faster", "up"],
      ["Change failure rate", "3.1%", null, "— flat vs prior 30d", "muted"],
      ["MTTR", "22m", null, "▼ 8m faster", "up"],
    ]);
  });

  it("flags change failure rate and MTTR as proxies, and nothing else", () => {
    const cells = doraStrip(seededInsights());

    expect(cells.filter((view) => view.proxy).map((view) => view.key)).toEqual(["change_failure_rate", "mttr"]);
  });

  it("names the proxy in the screen reader's sentence", () => {
    const [, , cfr] = doraStrip(seededInsights());

    expect(cfr!.summary).toBe(`Change failure rate (${PROXY_BADGE}): 3.1%. — flat vs prior 30d`);
  });

  it("dims the sparkline of a cell that did not move", () => {
    expect(doraStrip(seededInsights()).map((view) => view.dim)).toEqual([false, false, true, false]);
  });

  it("follows the page's own range in its comparisons", () => {
    const [deploy] = doraStrip(seededInsights({ range: "7d", dora: seededDora() }));

    expect(deploy!.delta).toBe("▲ 0.4/day vs prior 7d");
  });
});

describe("doraCell", () => {
  it("says a cell with nothing measured has not enough data, draws an em dash and no curve", () => {
    const view = doraCell(cell({ value: null, prior: null, delta: null, trend: { direction: "flat", good: null } }), "30d");

    expect(view).toMatchObject({ value: NOT_MEASURED, valueSuffix: null, delta: DORA_NOT_ENOUGH, tone: "muted", sparkline: null });
  });

  it("says there is nothing to compare when the prior window is empty", () => {
    expect(doraCell(cell({ prior: null, delta: null }), "90d").delta).toBe("No prior 90d to compare.");
  });

  it("colours a move by the service's goodness, not its sign", () => {
    expect(doraCell(cell({ delta: 0.4, trend: { direction: "up", good: false } }), "30d").tone).toBe("down");
  });

  it("says a slower duration is slower", () => {
    const [, lead] = seededDora();

    expect(doraCell({ ...lead!, delta: 600_000, trend: { direction: "up", good: false } }, "30d").delta).toBe(
      "▲ 10m slower",
    );
  });

  it("draws a percentage's move in points", () => {
    const [, , cfr] = seededDora();

    expect(doraCell({ ...cfr!, delta: 0.4, trend: { direction: "up", good: false } }, "30d").delta).toBe(
      "▲ 0.4pts vs prior 30d",
    );
  });

  it("trusts the registry's proxy flag even when the cell's own is missing", () => {
    const [, , cfr] = seededDora();

    expect(doraCell({ ...cfr!, proxy: false }, "30d").proxy).toBe(true);
  });
});

describe("sparklineOf", () => {
  it("never draws a flat line at zero", () => {
    expect(sparklineOf(cell({ value: 0, sparkline: [0, 0, 0, null, 0] }))).toBeNull();
  });

  it("draws nothing for a cell with no figure, whatever its days say", () => {
    expect(sparklineOf(cell({ value: null, sparkline: [1, 2, 3] }))).toBeNull();
  });

  it("draws a week as one bar per day, a missing day as zero height", () => {
    expect(sparklineOf(cell({ sparkline: [1, null, 3, 4, 5, 6, 7] }))).toEqual([1, 0, 3, 4, 5, 6, 7]);
  });

  it("groups a long window into at most fifteen bars, each the mean of its measured days", () => {
    const ninety = Array.from({ length: 90 }, (_, index) => (index < 6 ? (index % 2 === 0 ? 2 : null) : 1));
    const bars = sparklineOf(cell({ sparkline: ninety }))!;

    expect(bars).toHaveLength(SPARK_BARS);
    // The first run of six days measured 2, —, 2, —, 2, —: its bar is 2, not 1.
    expect(bars[0]).toBe(2);
    expect(bars.slice(1).every((bar) => bar === 1)).toBe(true);
  });
});
