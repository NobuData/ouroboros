import { median, medianRow, ratioRow, sumRow } from "./rollup.rows";

/**
 * Row constructors by aggregation (BI.2, #433). The median must be computed exactly as
 * `percentile_cont(0.5)` and V078's `metric_daily_shape_guard` compute it, or the database refuses
 * the row.
 */

const KEY = { repoRef: "acme/helios", metricId: "probe" };

describe("sum rows", () => {
  it("carry the value and an empty dimension by default", () => {
    expect(sumRow(KEY, 6)).toEqual({ ...KEY, dimension: "", value: 6 });
    expect(sumRow({ ...KEY, dimension: "unit" }, 0)).toEqual({
      ...KEY,
      dimension: "unit",
      value: 0,
    });
  });

  it.each([-1, Number.NaN, Infinity])("refuse %p — the grain stores neither", (value) => {
    expect(() => sumRow(KEY, value)).toThrow(RangeError);
  });
});

describe("ratio rows", () => {
  it("carry the components, and the day's rate scaled for its own chart point", () => {
    expect(ratioRow(KEY, 1, 3, 100)).toEqual({
      ...KEY,
      dimension: "",
      value: 100 / 3,
      numerator: 1,
      denominator: 3,
    });
    expect(ratioRow(KEY, 900_000, 2, 1).value).toBe(450_000);
  });

  it.each([0, -1, Number.NaN, Infinity])("refuse a denominator of %p", (denominator) => {
    expect(() => ratioRow(KEY, 1, denominator, 100)).toThrow(RangeError);
  });

  it("refuses a negative numerator", () => {
    expect(() => ratioRow(KEY, -1, 2, 100)).toThrow(RangeError);
  });
});

describe("median rows", () => {
  it("sort their samples and store the median of an odd count", () => {
    expect(medianRow(KEY, [40, 10, 20])).toEqual({
      ...KEY,
      dimension: "",
      value: 20,
      samples: [10, 20, 40],
    });
  });

  it("interpolate the middle two of an even count, as percentile_cont does", () => {
    expect(medianRow(KEY, [860_000, 2_400_000]).value).toBe(1_630_000);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("leave the caller's array alone", () => {
    const samples = [3, 1, 2];

    medianRow(KEY, samples);
    expect(samples).toEqual([3, 1, 2]);
  });

  it("refuse no samples, or a negative one", () => {
    expect(() => medianRow(KEY, [])).toThrow(RangeError);
    expect(() => medianRow(KEY, [1, -1])).toThrow(RangeError);
  });

  it("are not the average of medians — the whole point", () => {
    const day1 = medianRow(
      KEY,
      Array.from({ length: 40 }, () => 1_800_000),
    );
    const day2 = medianRow(KEY, [600_000]);
    const pooled = medianRow(KEY, [...(day1.samples ?? []), ...(day2.samples ?? [])]);

    expect(pooled.value).toBe(1_800_000);
    expect((day1.value + day2.value) / 2).not.toBe(pooled.value);
  });
});
