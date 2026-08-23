import { JITTER_SPREAD, chunked, jittered } from "./cadence";

/**
 * The anti-thundering-herd rule, and the chunking that keeps a sweep from opening fifty
 * sockets at once.
 *
 * `jittered` is driven with a fixed source rather than sampled, because the property that
 * matters is *the endpoints of the window*, and sampling a random function to assert a range
 * is a test that passes until it does not.
 */

const MINUTE = 60_000;

describe("the jittered delay", () => {
  it("is the base interval when the source lands in the middle", () => {
    expect(jittered(MINUTE, () => 0.5)).toBe(MINUTE);
  });

  it("reaches the bottom of the window and no further", () => {
    expect(jittered(MINUTE, () => 0)).toBe(MINUTE * (1 - JITTER_SPREAD));
  });

  it("reaches the top of the window and no further", () => {
    // `random()` is `[0, 1)`, so the top is approached rather than hit; the assertion is that
    // nothing exceeds it.
    expect(jittered(MINUTE, () => 0.999999)).toBeLessThanOrEqual(MINUTE * (1 + JITTER_SPREAD));
    expect(jittered(MINUTE, () => 0.999999)).toBeGreaterThan(MINUTE);
  });

  it("stays inside the window for every source value", () => {
    for (const sample of [0, 0.1, 0.25, 0.4, 0.6, 0.75, 0.9, 0.99]) {
      const delay = jittered(MINUTE, () => sample);

      expect(delay).toBeGreaterThanOrEqual(MINUTE * (1 - JITTER_SPREAD));
      expect(delay).toBeLessThanOrEqual(MINUTE * (1 + JITTER_SPREAD));
    }
  });

  it("never schedules on the next tick, however small the interval", () => {
    // `setTimeout(0)` is a spin rather than a schedule. The floor is what makes a
    // misconfigured or rounded-down interval a slow loop instead of a busy one.
    expect(jittered(1, () => 0)).toBeGreaterThanOrEqual(1);
  });

  it("is off the boundary for two instances that started together", () => {
    // The whole point: two processes booting in the same second must not agree on when to
    // knock. Two different sources give two different delays.
    expect(jittered(MINUTE, () => 0.1)).not.toBe(jittered(MINUTE, () => 0.9));
  });

  it("defaults its source, so the application does not have to supply one", () => {
    const delay = jittered(MINUTE);

    expect(delay).toBeGreaterThanOrEqual(MINUTE * (1 - JITTER_SPREAD));
    expect(delay).toBeLessThanOrEqual(MINUTE * (1 + JITTER_SPREAD));
  });
});

describe("chunking", () => {
  it("keeps order across the runs", () => {
    expect(chunked([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("answers an empty list with no runs, which is the common sweep", () => {
    expect(chunked([], 6)).toEqual([]);
  });

  it("makes one run of a list shorter than the width", () => {
    expect(chunked([1, 2], 6)).toEqual([[1, 2]]);
  });

  it("refuses to produce empty runs forever when asked for a width of zero", () => {
    expect(chunked([1, 2, 3], 0)).toEqual([[1], [2], [3]]);
  });
});
