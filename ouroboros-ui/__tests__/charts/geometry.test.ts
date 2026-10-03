import { describe, expect, it } from "vitest";

import {
  areaPath,
  domainMax,
  fractionOf,
  gridlineYs,
  linePoints,
  percentProperty,
  placePoints,
  plotFrame,
  sparseTicks,
  tickAnchor,
  xOf,
  yOf,
} from "@/app/charts/geometry";

/**
 * The arithmetic under the chart primitives (#442), against mockup 15's own coordinates.
 *
 * The throughput chart is a `640 × 196` viewBox whose domain top is `y = 40`, whose baseline
 * is `y = 166`, and whose thirty points run from `x = 10` to `x = 630`. Reproducing those
 * numbers from the data is what "pixel-close" means for the geometry.
 */

const THROUGHPUT = plotFrame(640, 196);

describe("plotFrame", () => {
  it("reproduces the throughput chart's frame", () => {
    expect(THROUGHPUT).toEqual({ width: 640, height: 196, inset: 10, left: 10, top: 39, baseline: 166 });
  });

  it("keeps a gutter on the left for a y-axis's labels, and none by default or for a negative one", () => {
    // Mockup 18's duration chart starts its plot at x = 40 and ends it where every chart does.
    expect(plotFrame(640, 180, 30)).toMatchObject({ left: 40, inset: 10 });
    expect(plotFrame(640, 180).left).toBe(10);
    expect(plotFrame(640, 180, -5).left).toBe(10);
  });

  it("refuses a box too small to hold a plot", () => {
    const tiny = plotFrame(0, 0);

    expect(tiny.width).toBe(40);
    expect(tiny.baseline).toBeGreaterThan(tiny.top);
  });
});

describe("domainMax", () => {
  it("is the series' largest value", () => {
    expect(domainMax([3, 6, 2])).toBe(6);
  });

  it("reaches a guide drawn above the series, so the guide stays in the plot", () => {
    expect(domainMax([3, 6, 2], 20)).toBe(20);
    expect(domainMax([3, 6, 2], 4)).toBe(6);
  });

  it("is one for an empty or all-zero series, so nothing divides by zero", () => {
    expect(domainMax([])).toBe(1);
    expect(domainMax([0, 0])).toBe(1);
    expect(domainMax([Number.NaN])).toBe(1);
  });
});

describe("placing a point", () => {
  it("puts zero on the baseline and the domain's top on the top", () => {
    expect(yOf(0, 6, THROUGHPUT)).toBe(166);
    expect(yOf(6, 6, THROUGHPUT)).toBe(39);
  });

  it("clamps a value outside the domain rather than drawing past the box", () => {
    expect(yOf(-3, 6, THROUGHPUT)).toBe(166);
    expect(yOf(12, 6, THROUGHPUT)).toBe(39);
    expect(yOf(Number.NaN, 6, THROUGHPUT)).toBe(166);
  });

  it("spreads thirty points from inset to inset, as the mockup does", () => {
    expect(xOf(0, 30, THROUGHPUT)).toBe(10);
    expect(xOf(29, 30, THROUGHPUT)).toBe(630);
    // The mockup's crosshair day, Aug 4, is drawn at x = 545.
    expect(Math.round(xOf(25, 30, THROUGHPUT))).toBe(544);
  });

  it("draws a single point at the right, where the latest value of a series sits", () => {
    expect(xOf(0, 1, THROUGHPUT)).toBe(630);
  });

  it("spreads the points from the gutter's edge to the right inset when there is a y-axis", () => {
    const axed = plotFrame(640, 180, 30);

    expect(xOf(0, 89, axed)).toBe(40);
    expect(xOf(88, 89, axed)).toBe(630);
    expect(xOf(44, 89, axed)).toBe(335);
  });

  it("draws a domain that does not start at zero from its floor, clamping what is below it", () => {
    const axed = plotFrame(640, 180, 30);

    // Three minutes on the baseline, six at the top, as the mockup's axis reads.
    expect(yOf(180, 360, axed, 180)).toBe(axed.baseline);
    expect(yOf(360, 360, axed, 180)).toBe(axed.top);
    expect(yOf(270, 360, axed, 180)).toBe((axed.baseline + axed.top) / 2);
    expect(yOf(60, 360, axed, 180)).toBe(axed.baseline);
    expect(placePoints([180, 360], 360, axed, 180).map((point) => point.y)).toEqual([axed.baseline, axed.top]);
  });

  it("puts everything on the baseline for a domain with no height, rather than dividing by zero", () => {
    expect(yOf(5, 5, THROUGHPUT, 5)).toBe(166);
    expect(yOf(9, 5, THROUGHPUT, 5)).toBe(166);
  });
});

describe("the line and the area", () => {
  const placed = placePoints([0, 6], 6, THROUGHPUT);

  it("writes the polyline's points", () => {
    expect(linePoints(placed)).toBe("10,166 630,39");
    expect(linePoints([])).toBe("");
  });

  it("closes the area down to the baseline at both ends", () => {
    expect(areaPath(placed, THROUGHPUT)).toBe("M10,166 L10,166 L630,39 L630,166 Z");
  });

  it("draws no area for fewer than two points — one point encloses nothing", () => {
    expect(areaPath(placePoints([4], 6, THROUGHPUT), THROUGHPUT)).toBe("");
    expect(areaPath([], THROUGHPUT)).toBe("");
  });
});

describe("gridlineYs", () => {
  it("spaces the dimmed lines evenly from the top, leaving the baseline to be drawn solid", () => {
    const ys = gridlineYs(3, THROUGHPUT);

    expect(ys).toHaveLength(3);
    expect(ys[0]).toBe(39);
    expect(ys).not.toContain(166);
    expect(ys[1]! - ys[0]!).toBeCloseTo(ys[2]! - ys[1]!, 1);
  });

  it("draws none when asked for none", () => {
    expect(gridlineYs(0, THROUGHPUT)).toEqual([]);
    expect(gridlineYs(-2, THROUGHPUT)).toEqual([]);
  });
});

describe("sparse ticks", () => {
  it("labels a thirty-day series near its start, its middle and its end", () => {
    expect(sparseTicks(30)).toEqual([2, 15, 29]);
  });

  it("collapses on a short series rather than labelling a day twice", () => {
    expect(sparseTicks(1)).toEqual([0]);
    expect(sparseTicks(2)).toEqual([0, 1]);
    expect(sparseTicks(0)).toEqual([]);
  });

  it("hangs the last label off its end and the first off its start", () => {
    expect(tickAnchor(29, 30)).toBe("end");
    expect(tickAnchor(0, 30)).toBe("start");
    expect(tickAnchor(15, 30)).toBe("middle");
  });
});

describe("bar fractions", () => {
  it("scales a value to the largest in its set", () => {
    expect(fractionOf(5, 8)).toBe(0.625);
    expect(percentProperty(0.625)).toBe("62.5%");
  });

  it("stays inside the track for every input", () => {
    expect(fractionOf(9, 8)).toBe(1);
    expect(fractionOf(-1, 8)).toBe(0);
    expect(fractionOf(3, 0)).toBe(0);
    expect(fractionOf(Number.NaN, 8)).toBe(0);
  });
});
