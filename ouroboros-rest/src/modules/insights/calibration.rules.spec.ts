import {
  biasDirection,
  calibrationReport,
  effortCalibration,
  percentage,
  windowRange,
  type CalibrationSliceSums,
} from "./calibration.rules";

/**
 * The report's arithmetic (#435): the headline re-derives from counts rather than averaging the
 * slices, unestimated merges are counted rather than dropped, and every effort carries the
 * direction of its bias — not just its magnitude.
 */

const NOW = new Date("2026-10-01T12:00:00.000Z");
const RANGE = windowRange("30d", NOW);

/**
 * A group's sums.
 *
 * @param overrides - What differs from an empty group at effort `s`.
 * @returns The sums.
 */
function sums(overrides: Partial<CalibrationSliceSums>): CalibrationSliceSums {
  return {
    effort: "s",
    merged: 0,
    withinBand: 0,
    over: 0,
    under: 0,
    deviationMs: 0,
    midpointMs: 0,
    ...overrides,
  };
}

describe("windowRange", () => {
  it.each([
    ["7d", "2026-09-24T12:00:00.000Z"],
    ["30d", "2026-09-01T12:00:00.000Z"],
    ["90d", "2026-07-03T12:00:00.000Z"],
  ] as const)("spans %s, ending now", (window, from) => {
    expect(windowRange(window, NOW)).toEqual({ from: new Date(from), to: NOW });
  });
});

describe("percentage", () => {
  it("rounds to one decimal", () => {
    expect(percentage(35, 39)).toBe(89.7);
    expect(percentage(1, 3)).toBe(33.3);
    expect(percentage(-120, 1000)).toBe(-12);
  });

  it("is null over nothing, never 0% or NaN", () => {
    expect(percentage(0, 0)).toBeNull();
    expect(percentage(3, -1)).toBeNull();
  });
});

describe("biasDirection", () => {
  it("reads the sign of the summed deviations", () => {
    expect(biasDirection(40_000)).toBe("over");
    expect(biasDirection(-40_000)).toBe("under");
    expect(biasDirection(0)).toBe("even");
  });
});

describe("effortCalibration", () => {
  it("reports magnitude and direction: L runs 12% over", () => {
    expect(
      effortCalibration(
        "l",
        sums({
          effort: "l",
          merged: 4,
          withinBand: 3,
          over: 1,
          deviationMs: 1_008_000,
          midpointMs: 8_400_000,
        }),
      ),
    ).toEqual({
      effort: "l",
      estimated: 4,
      withinBand: 3,
      withinBandPct: 75,
      over: 1,
      under: 0,
      biasPct: 12,
      bias: "over",
    });
  });

  it("distinguishes under-estimation from over-estimation", () => {
    const slice = effortCalibration(
      "xs",
      sums({ effort: "xs", merged: 2, under: 2, deviationMs: -540_000, midpointMs: 900_000 }),
    );

    expect([slice.biasPct, slice.bias, slice.under, slice.over]).toEqual([-60, "under", 2, 0]);
  });

  it("is present with zeros and nulls for an effort the window has no merges at", () => {
    expect(effortCalibration("xl", undefined)).toEqual({
      effort: "xl",
      estimated: 0,
      withinBand: 0,
      withinBandPct: null,
      over: 0,
      under: 0,
      biasPct: null,
      bias: null,
    });
  });

  it("gives a direction but no percentage when every band was 0–0", () => {
    const slice = effortCalibration("xs", sums({ effort: "xs", merged: 1, deviationMs: 60_000 }));

    expect([slice.biasPct, slice.bias]).toEqual([null, "over"]);
  });
});

describe("calibrationReport", () => {
  const groups: CalibrationSliceSums[] = [
    sums({ effort: null, merged: 3 }),
    sums({
      effort: "m",
      merged: 10,
      withinBand: 9,
      under: 1,
      deviationMs: -60_000,
      midpointMs: 9_000_000,
    }),
    sums({ effort: "s", merged: 2, withinBand: 2, deviationMs: 0, midpointMs: 1_800_000 }),
  ];

  it("re-derives the headline from counts — not the mean of the slice rates", () => {
    const report = calibrationReport("30d", RANGE, groups);

    // (9 + 2) / (10 + 2) = 91.7%; the mean of 90% and 100% would be 95%.
    expect(report).toMatchObject({ estimated: 12, withinBand: 11, withinBandPct: 91.7 });
  });

  it("counts the unestimated beside the estimated rather than dropping them", () => {
    expect(calibrationReport("30d", RANGE, groups)).toMatchObject({
      merged: 15,
      estimated: 12,
      unestimated: 3,
    });
  });

  it("carries all five efforts, smallest first, whatever order the groups came in", () => {
    const report = calibrationReport("30d", RANGE, groups);

    expect(report.efforts.map((slice) => [slice.effort, slice.estimated, slice.bias])).toEqual([
      ["xs", 0, null],
      ["s", 2, "even"],
      ["m", 10, "under"],
      ["l", 0, null],
      ["xl", 0, null],
    ]);
  });

  it("states its window as instants", () => {
    expect(calibrationReport("30d", RANGE, [])).toEqual({
      window: "30d",
      from: "2026-09-01T12:00:00.000Z",
      to: "2026-10-01T12:00:00.000Z",
      merged: 0,
      estimated: 0,
      unestimated: 0,
      withinBand: 0,
      withinBandPct: null,
      efforts: expect.any(Array) as unknown,
    });
  });
});
