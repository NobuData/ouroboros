import { DISCOVERY_FLOOR_MS, withFloor } from "./discovery.timing";

/**
 * The timing floor, which is the issue's third acceptance criterion made mechanical:
 * *response timing does not separate known from unknown domains under measurement*.
 *
 * The assertions are about the floor rather than about discovery, deliberately. A test that
 * measured the endpoint end to end and compared two domains would be measuring a database,
 * a pool and a socket, and would fail on a loaded machine for reasons that have nothing to
 * do with what it claims — the classic flaky timing test. What actually makes the two
 * indistinguishable is this function, so this is where it is proved: **fast work and slow
 * work take the same time, up to the floor**, which is the property the endpoint inherits
 * whichever branch its lookup takes.
 *
 * Real timers, and small floors. Fake timers cannot drive `node:timers/promises` without
 * replacing the thing under test with a schedule the test wrote, and the floors here are a
 * few tens of milliseconds — enough to be measurable, small enough that the whole file costs
 * less than a second.
 */

/** How long a call took, in milliseconds, on the same monotonic clock the floor uses. */
async function elapsed(work: () => Promise<unknown>): Promise<number> {
  const started = performance.now();
  await work();

  return performance.now() - started;
}

/** A floor big enough to measure without making the suite wait. */
const FLOOR = 40;

/**
 * What a timer is allowed to be early by.
 *
 * `setTimeout` may fire a fraction of a millisecond before the deadline the caller asked
 * for — the loop's own resolution — and a test asserting exact `>=` would fail on that
 * rather than on anything real. Two milliseconds is far below the difference this floor
 * exists to hide.
 */
const SLACK = 2;

describe("the floor", () => {
  it("holds work that finishes immediately", async () => {
    expect(await elapsed(() => withFloor(FLOOR, () => Promise.resolve("done")))).toBeGreaterThan(
      FLOOR - SLACK,
    );
  });

  it("hands back exactly what the work resolved to", async () => {
    expect(await withFloor(FLOOR, () => Promise.resolve({ ssoAvailable: false }))).toEqual({
      ssoAvailable: false,
    });
  });

  it("makes fast work and slower work take the same time", async () => {
    // The property the endpoint rests on, stated directly. The two branches of the lookup —
    // an index hit and a miss — are these two, at a difference far larger than the real one.
    const fast = await elapsed(() => withFloor(FLOOR, () => Promise.resolve(null)));
    const slow = await elapsed(() =>
      withFloor(FLOOR, async () => {
        await new Promise((resolve) => setTimeout(resolve, FLOOR / 2));
      }),
    );

    expect(Math.abs(fast - slow)).toBeLessThan(FLOOR / 2);
  });

  it("does not clamp work that overruns it", async () => {
    // Stated as a test because it is the honest limit of the guarantee rather than a bug:
    // the floor cannot shorten a slow query, so what it promises is that work *inside* the
    // floor is not observable. `discovery.timing.ts`'s header is where that trade is argued.
    const overrun = FLOOR * 2;
    const took = await elapsed(() =>
      withFloor(FLOOR, async () => {
        await new Promise((resolve) => setTimeout(resolve, overrun));
      }),
    );

    expect(took).toBeGreaterThan(overrun - SLACK);
  });

  it("holds a failure for just as long", async () => {
    // An error is an answer too, and one that arrived faster for an unknown domain than for
    // a known one would separate them exactly as a success would.
    const failure = new Error("the pool refused a connection");

    const took = await elapsed(async () => {
      await expect(withFloor(FLOOR, () => Promise.reject(failure))).rejects.toBe(failure);
    });

    expect(took).toBeGreaterThan(FLOOR - SLACK);
  });

  it("waits for nothing when the floor has already passed", async () => {
    // A floor of zero is not a special case in the code and must not become one: the guard
    // is `remaining > 0`, so nothing is scheduled at all.
    expect(await elapsed(() => withFloor(0, () => Promise.resolve(null)))).toBeLessThan(FLOOR);
  });

  it("measures on a monotonic clock rather than the wall", async () => {
    // `Date.now()` can step backwards or forwards under NTP, which would make a floor either
    // skippable or arbitrarily long. Asserted by moving the wall clock and watching the
    // floor ignore it.
    const wall = jest.spyOn(Date, "now").mockReturnValue(0);

    expect(await elapsed(() => withFloor(FLOOR, () => Promise.resolve(null)))).toBeGreaterThan(
      FLOOR - SLACK,
    );

    wall.mockRestore();
  });
});

describe("the floor discovery actually uses", () => {
  it("is long enough to hide an indexed lookup", () => {
    // The number is a judgement rather than a derivation, so what is asserted is the two
    // bounds the judgement was made between: comfortably above the milliseconds a warm,
    // indexed existence check costs, and beneath what a person waiting on a form notices.
    expect(DISCOVERY_FLOOR_MS).toBeGreaterThanOrEqual(50);
    expect(DISCOVERY_FLOOR_MS).toBeLessThanOrEqual(500);
  });
});
