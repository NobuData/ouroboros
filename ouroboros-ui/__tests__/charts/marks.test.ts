import { describe, expect, it } from "vitest";

import {
  CHART_MIN_WIDTH_REM,
  MARK_GAP_REM,
  MARK_OFFSET_REM,
  type MarkInput,
  type MarkMeasure,
  layoutMarks,
  markWidthRem,
  maxMarkChars,
} from "@/app/charts/marks";

/**
 * Where a time series' marker chips go (#517): the collision-aware half of the annotation layer.
 *
 * Three chips on ninety days is the mockup; six in one fortnight is what a real repository does.
 * The promise under test is that no two chips of one row ever touch — at the narrowest width the
 * chart is drawn, and therefore at every wider one.
 */

/** The wide card's chart, whose plot ends ten viewBox units from a 640-unit right edge. */
const WIDE: MarkMeasure = { widthRem: CHART_MIN_WIDTH_REM.wide, end: 10 / 640 };

/** A chip at a viewBox x of a 640-wide chart. */
function at(x: number, label: string): MarkInput {
  return { x: x / 640, chars: label.length };
}

/**
 * A chip's edges at any width, by `charts.css`'s own rule: just after its vertical, or as far
 * left of that as it takes to end at the plot's right edge.
 *
 * @param mark The chip.
 * @param chars The characters it was given room for.
 * @param widthRem The chart's width.
 * @param measure The chart.
 * @returns Its left and right edges, in rem.
 */
function edgesAt(mark: MarkInput, chars: number, widthRem: number, measure: MarkMeasure) {
  const span = markWidthRem(chars);
  const left = Math.max(0, Math.min(mark.x * widthRem + MARK_OFFSET_REM, widthRem * (1 - measure.end) - span));

  return { left, right: left + span };
}

/**
 * Every pair of chips that share a row and overlap, at one width.
 *
 * @param marks The chips.
 * @param measure The chart.
 * @param widthRem The width to check at.
 * @returns The offending pairs' indices — empty when the layout holds.
 */
function collisions(marks: readonly MarkInput[], measure: MarkMeasure, widthRem: number): [number, number][] {
  const { placements } = layoutMarks(marks, measure);
  const pairs: [number, number][] = [];

  for (let a = 0; a < marks.length; a++) {
    for (let b = a + 1; b < marks.length; b++) {
      if (placements[a]!.row !== placements[b]!.row) continue;

      const first = edgesAt(marks[a]!, placements[a]!.chars, widthRem, measure);
      const second = edgesAt(marks[b]!, placements[b]!.chars, widthRem, measure);

      if (first.left < second.right && second.left < first.right) pairs.push([a, b]);
    }
  }

  return pairs;
}

describe("the mockup's three chips", () => {
  // The seed's three breakpoints — 82, 47 and 9 days before the run — are points 7, 42 and 80 of
  // 89, spread from x = 40 (after the y-axis's gutter) to x = 630. The mockup draws its chips in
  // a 9.5px face; the product's smallest step is 11px, and they still take the mockup's two rows.
  const marks = [
    at(40 + (7 / 88) * 590, "May 18 · Zephyr 4.1 migration +1m 30s"),
    at(40 + (42 / 88) * 590, "Jun 22 · ccache enabled −2m 10s"),
    at(40 + (80 / 88) * 590, "Jul 30 · twister suite growth +40s"),
  ];

  it("take two rows: the first and the last on top, the middle one stepped down", () => {
    const layout = layoutMarks(marks, WIDE);

    expect(layout.rows).toBe(2);
    expect(layout.placements.map((placement) => placement.row)).toEqual([0, 1, 0]);
  });

  it("start a chip just after its vertical", () => {
    const [first] = layoutMarks(marks, WIDE).placements;

    expect(first!.left).toBeCloseTo(((40 + (7 / 88) * 590) / 640) * 40 + MARK_OFFSET_REM, 5);
  });

  it("hold the last chip against the plot's right edge rather than letting it run off", () => {
    const last = layoutMarks(marks, WIDE).placements[2]!;

    expect(last.right).toBeCloseTo(40 * (1 - 10 / 640), 5);
    expect(last.left).toBeLessThan(((40 + (80 / 88) * 590) / 640) * 40);
  });
});

describe("clustered change-points", () => {
  // Three breakpoints inside two weeks: day 40, 45 and 52 of a ninety-day series.
  const cluster = (
    [
      [40, "Aug 14 · deps: refresh west manifest +55s"],
      [45, "Aug 19 · ccache enabled −2m 10s"],
      [52, "Aug 26 · twister suite growth +40s"],
    ] as const
  ).map(([day, label]) => at(40 + (day / 89) * 590, label));

  it("stack, one row each, stepping down to the right beside their own verticals", () => {
    const layout = layoutMarks(cluster, WIDE);

    expect(layout.rows).toBe(3);
    expect(layout.placements.map((placement) => placement.row)).toEqual([0, 1, 2]);
  });

  it("never overlap within a row, keeping the gap", () => {
    const { placements } = layoutMarks(cluster, WIDE);

    for (const [a, b] of [[0, 1], [0, 2], [1, 2]] as const) {
      if (placements[a]!.row !== placements[b]!.row) continue;

      expect(placements[b]!.left - placements[a]!.right).toBeGreaterThanOrEqual(MARK_GAP_REM);
    }
    expect(collisions(cluster, WIDE, WIDE.widthRem)).toEqual([]);
  });

  it("stay clear of one another at every wider width, and for a dense fortnight of six", () => {
    const six = [38, 40, 43, 45, 49, 52].map((day) => at(40 + (day / 89) * 590, "Aug 19 · ccache enabled −2m 10s"));

    for (const widthRem of [40, 41, 47.5, 60, 96, 160]) {
      expect(collisions(cluster, WIDE, widthRem), `three chips at ${widthRem}rem`).toEqual([]);
      expect(collisions(six, WIDE, widthRem), `six chips at ${widthRem}rem`).toEqual([]);
    }
    expect(layoutMarks(six, WIDE).rows).toBe(6);
  });

  it("go back to the top row once a chip is clear of the cluster", () => {
    const layout = layoutMarks([...cluster, at(60, "Jul 8 · image bump +12s")], WIDE);

    expect(layout.placements[3]!.row).toBe(0);
    expect(layout.rows).toBe(3);
  });
});

describe("the layout's edges", () => {
  it("takes no rows for no chips", () => {
    expect(layoutMarks([], WIDE)).toEqual({ placements: [], rows: 0 });
  });

  it("answers in the order it was asked, whatever order the chips came in", () => {
    const late = at(500, "Sep 1 · late +10s");
    const early = at(100, "Jul 1 · early +10s");
    const layout = layoutMarks([late, early], WIDE);

    expect(layout.placements[0]!.left).toBeGreaterThan(layout.placements[1]!.left);
    expect(layout.rows).toBe(1);
  });

  it("gives two chips on one point a row each", () => {
    const layout = layoutMarks([at(300, "Aug 1 · one +10s"), at(300, "Aug 1 · two −10s")], WIDE);

    expect(layout.placements.map((placement) => placement.row)).toEqual([0, 1]);
  });

  it("gives a label wider than the whole plot only the room the plot has", () => {
    const limit = maxMarkChars(WIDE);
    const [placement] = layoutMarks([{ x: 0.5, chars: 400 }], WIDE).placements;

    expect(placement!.chars).toBe(limit);
    expect(placement!.left).toBeGreaterThanOrEqual(0);
    expect(placement!.right).toBeLessThanOrEqual(40 * (1 - WIDE.end) + 1e-9);
    expect(markWidthRem(limit + 1)).toBeGreaterThan(40 * (1 - WIDE.end));
  });

  it("holds for the half card's narrower chart too", () => {
    const half: MarkMeasure = { widthRem: CHART_MIN_WIDTH_REM.half, end: 10 / 560 };
    const marks = [at(100, "May 18 · Zephyr 4.1 migration +1m 30s"), at(300, "Jun 22 · ccache enabled −2m 10s")];

    for (const widthRem of [30, 36, 64]) expect(collisions(marks, half, widthRem)).toEqual([]);
  });

  it("places a chip whose x is not a number at the left edge rather than nowhere", () => {
    const [placement] = layoutMarks([{ x: Number.NaN, chars: 10 }], WIDE).placements;

    expect(placement).toMatchObject({ row: 0, left: MARK_OFFSET_REM });
  });
});
