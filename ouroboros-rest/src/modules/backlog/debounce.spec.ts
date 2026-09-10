import { MINIMUM_SYNC_INTERVAL_SECONDS, retryAfterSeconds } from "./debounce";

/**
 * The minimum-interval guard, which is arithmetic and is therefore worth testing as
 * arithmetic — `sync-trigger.service.spec.ts` asserts that the refusal happens, and this
 * asserts that the number in it is the right one.
 *
 * The rounding is the part with a reason: a hint that rounded *down* would tell a client to
 * retry a moment before the guard lifts and collect a second refusal, which is exactly the
 * request the guard exists to prevent.
 */

/** When the last cycle began, in every case below. */
const STARTED = new Date("2026-09-10T14:00:00.000Z");

/**
 * A clock this many milliseconds after the cycle started.
 *
 * @param elapsedMs - How long ago the cycle began.
 * @returns The instant.
 */
function after(elapsedMs: number): Date {
  return new Date(STARTED.getTime() + elapsedMs);
}

describe("the minimum interval", () => {
  it("is thirty seconds — short enough to be worth clicking, long enough to bound the spend", () => {
    // Pinned rather than derived, because it is a decision: a hundred and twenty cycles an
    // hour is small against one token's five thousand requests, and a person who has just
    // filed an issue is not sent back to waiting out the poll interval.
    expect(MINIMUM_SYNC_INTERVAL_SECONDS).toBe(30);
  });
});

describe("how long to wait", () => {
  it("says nothing to wait for when this process has completed no cycle", () => {
    // A fresh process has nothing to be too soon after, and refusing the first trigger of a
    // deployment would be a guard with no state to justify it.
    expect(retryAfterSeconds(undefined, after(0))).toBeUndefined();
  });

  it("refuses immediately after a cycle, for the whole interval", () => {
    expect(retryAfterSeconds(STARTED, after(0))).toBe(MINIMUM_SYNC_INTERVAL_SECONDS);
  });

  it("counts down as the interval passes", () => {
    expect(retryAfterSeconds(STARTED, after(8_000))).toBe(22);
  });

  it("rounds a part-second up, so a client that waits exactly this long is not refused twice", () => {
    expect(retryAfterSeconds(STARTED, after(29_100))).toBe(1);
  });

  it("never answers zero, which would read as `go ahead`", () => {
    expect(retryAfterSeconds(STARTED, after(29_999))).toBe(1);
  });

  it("permits a trigger the moment the interval has elapsed", () => {
    expect(retryAfterSeconds(STARTED, after(30_000))).toBeUndefined();
  });

  it("permits one long after", () => {
    expect(retryAfterSeconds(STARTED, after(3_600_000))).toBeUndefined();
  });

  it("bounds a clock that moved backwards by the interval rather than by the drift", () => {
    // A cycle stamped in the future is a host whose clock was corrected, not a reason to
    // refuse re-syncs for an hour.
    expect(retryAfterSeconds(STARTED, after(-3_600_000))).toBe(MINIMUM_SYNC_INTERVAL_SECONDS);
  });
});
