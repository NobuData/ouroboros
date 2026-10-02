import {
  JITTER_SPREAD,
  chunked,
  jittered,
  latestWeeklySlot,
  nextNightlySlot,
  nextWeeklySlot,
  nightlyDelay,
} from "./cadence";

/**
 * The anti-thundering-herd rule, and the chunking that keeps a background loop from opening
 * fifty sockets at once.
 *
 * `jittered` is driven with a fixed source rather than sampled, because the property that
 * matters is *the endpoints of the window*, and sampling a random function to assert a range
 * is a test that passes until it does not.
 *
 * Written for the provider-health sweep ([#196](https://github.com/NobuData/ouroboros/issues/196))
 * and moved here with the code when the backlog sync
 * ([#102](https://github.com/NobuData/ouroboros/issues/102)) became the second caller.
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

describe("the nightly slot (AL.5, #281)", () => {
  it("is today's hour when the hour is still ahead", () => {
    const slot = nextNightlySlot(new Date("2026-09-17T01:59:59.000Z"), 2);

    expect(slot).toEqual({ night: "2026-09-17", at: new Date("2026-09-17T02:00:00.000Z") });
  });

  it("is tomorrow's once the hour has arrived or passed, so a finished run never re-books itself", () => {
    expect(nextNightlySlot(new Date("2026-09-17T02:00:00.000Z"), 2).night).toBe("2026-09-18");
    expect(nextNightlySlot(new Date("2026-09-17T02:14:00.000Z"), 2).night).toBe("2026-09-18");
    expect(nextNightlySlot(new Date("2026-09-17T23:59:00.000Z"), 2).at).toEqual(
      new Date("2026-09-18T02:00:00.000Z"),
    );
  });

  it("crosses a month and a year", () => {
    expect(nextNightlySlot(new Date("2026-12-31T12:00:00.000Z"), 0).night).toBe("2027-01-01");
    expect(nextNightlySlot(new Date("2026-02-28T23:00:00.000Z"), 23).night).toBe("2026-03-01");
  });

  it("is always in the future, for every hour", () => {
    const now = new Date("2026-09-17T13:37:00.000Z");

    for (let hour = 0; hour <= 23; hour += 1) {
      const { at } = nextNightlySlot(now, hour);

      expect(at.getTime()).toBeGreaterThan(now.getTime());
      expect(at.getTime() - now.getTime()).toBeLessThanOrEqual(24 * 60 * MINUTE);
      expect(at.getUTCHours()).toBe(hour);
    }
  });
});

describe("the nightly delay (AL.5, #281)", () => {
  const now = new Date("2026-09-17T01:00:00.000Z");
  const slot = nextNightlySlot(now, 2);

  it("lands on the hour at the bottom of the window", () => {
    expect(nightlyDelay(now, slot, 30, () => 0)).toBe(60 * MINUTE);
  });

  it("lands inside the window after the hour, never before it and never past it", () => {
    for (const sample of [0.1, 0.5, 0.9, 0.999999]) {
      const delay = nightlyDelay(now, slot, 30, () => sample);

      expect(delay).toBeGreaterThan(60 * MINUTE);
      expect(delay).toBeLessThan(90 * MINUTE);
    }
  });

  it("is jittered: two sources give two delays", () => {
    expect(nightlyDelay(now, slot, 30, () => 0.2)).not.toBe(nightlyDelay(now, slot, 30, () => 0.7));
  });

  it("never goes below one millisecond for a slot already reached", () => {
    expect(nightlyDelay(new Date("2026-09-17T03:00:00.000Z"), slot, 30, () => 0)).toBe(1);
  });
});

describe("the weekly slot (BJ.4, #440)", () => {
  // 2026-10-01 is a Thursday.
  const THURSDAY_NOON = new Date("2026-10-01T12:00:00.000Z");

  it.each([
    // Monday 09:00 was three days ago.
    [1, "09:00", "2026-09-28T09:00:00.000Z"],
    // Earlier today.
    [4, "09:00", "2026-10-01T09:00:00.000Z"],
    // Later today has not happened, so the latest is last week's.
    [4, "16:30", "2026-09-24T16:30:00.000Z"],
    // Sunday is ISO day 7, and was four days ago.
    [7, "23:59", "2026-09-27T23:59:00.000Z"],
    // Friday is tomorrow; last Friday is the latest.
    [5, "00:00", "2026-09-25T00:00:00.000Z"],
  ])("looks back to day %i at %s", (day, time, expected) => {
    expect(latestWeeklySlot(THURSDAY_NOON, day, time).toISOString()).toBe(expected);
  });

  it("counts a slot that is exactly now as reached", () => {
    expect(latestWeeklySlot(THURSDAY_NOON, 4, "12:00")).toEqual(THURSDAY_NOON);
  });

  it("looks back correctly from a Sunday, the day the two numberings disagree about", () => {
    const sunday = new Date("2026-10-04T10:00:00.000Z");

    expect(latestWeeklySlot(sunday, 7, "09:00").toISOString()).toBe("2026-10-04T09:00:00.000Z");
    expect(latestWeeklySlot(sunday, 1, "09:00").toISOString()).toBe("2026-09-28T09:00:00.000Z");
  });

  it("books the next slot strictly after now, a week past the latest", () => {
    expect(nextWeeklySlot(THURSDAY_NOON, 1, "09:00").toISOString()).toBe(
      "2026-10-05T09:00:00.000Z",
    );
    expect(nextWeeklySlot(THURSDAY_NOON, 4, "12:00").toISOString()).toBe(
      "2026-10-08T12:00:00.000Z",
    );
    expect(nextWeeklySlot(THURSDAY_NOON, 4, "16:30").toISOString()).toBe(
      "2026-10-01T16:30:00.000Z",
    );
  });

  it.each([
    [0, "09:00"],
    [8, "09:00"],
    [1.5, "09:00"],
    [1, "9:00"],
    [1, "24:00"],
    [1, "09:60"],
    [1, "09:00:00"],
  ])("refuses day %s at %s", (day, time) => {
    expect(() => latestWeeklySlot(THURSDAY_NOON, day, time)).toThrow(RangeError);
  });
});
