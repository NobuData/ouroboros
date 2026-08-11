import { Logger } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { TerminusModule } from "@nestjs/terminus";

import { DATABASE_KEY, DatabaseHealthIndicator } from "./database.health";
import { DATABASE_PROBE_POOL, PROBE_STATEMENT, type ProbePool } from "./database.pool";
import { PROBE_TIMEOUT_MS } from "./probe";
import {
  answeringPool,
  connectionRefused,
  hangingPool,
  refusingPool,
  type FakeProbePool,
} from "./probe.fixture";

/**
 * The database half of `/health/ready`, against a database that answers, one that refuses
 * and one that never comes back.
 *
 * Every assertion here is about the *answer*, because the answer is the contract: a key
 * called `database`, a status of `up` or `down`, and a message an unauthenticated caller may
 * read. The indicator is also asserted never to reject — Terminus turns an indicator that
 * throws into a `500` on the probe itself, which tells a reader that the probe is broken
 * rather than that the database is down.
 */

/** The status one indicator reported, as Terminus keys it. */
type Reported = { status: string; message?: string };

/**
 * Build the indicator over a given pool.
 *
 * Resolved through the injector, with the pool bound to the token `HealthModule` binds, so
 * this fails if the wiring changes rather than only if the logic does.
 *
 * @param pool - The database to probe.
 * @returns The indicator, ready to check.
 */
async function indicatorOver(pool: ProbePool): Promise<DatabaseHealthIndicator> {
  const moduleRef = await Test.createTestingModule({
    imports: [TerminusModule],
    providers: [DatabaseHealthIndicator, { provide: DATABASE_PROBE_POOL, useValue: pool }],
  }).compile();

  return moduleRef.get(DatabaseHealthIndicator);
}

/**
 * Check the database and read the one status it reported.
 *
 * @param pool - The database to probe.
 * @returns What the indicator said about `database`.
 */
async function report(pool: ProbePool): Promise<Reported> {
  const indicator = await indicatorOver(pool);
  const result = await indicator.check();

  return result[DATABASE_KEY] as Reported;
}

describe("DatabaseHealthIndicator", () => {
  beforeEach(() => {
    // The indicator logs the driver's own diagnosis, which is deliberate and noisy: without
    // this the suite's output is a wall of stack traces from failures it caused on purpose.
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  it("is keyed as the dependency the issue asks it to name", () => {
    expect(DATABASE_KEY).toBe("database");
  });

  it("reports up when the database answers", async () => {
    await expect(report(answeringPool())).resolves.toEqual({ status: "up" });
  });

  it("asks the cheapest question there is, and only that one", async () => {
    const pool = answeringPool();

    await report(pool);

    expect(pool.statements).toEqual([PROBE_STATEMENT]);
  });

  it("reports down when the database refuses the connection", async () => {
    const reported = await report(refusingPool());

    expect(reported.status).toBe("down");
    expect(reported.message).toBe(`${PROBE_STATEMENT} failed (ECONNREFUSED)`);
  });

  it("reports down when the database never answers, without waiting for it", async () => {
    // The indicator is built before the clock is faked, so the only thing the fake clock has
    // to drive is the deadline itself — and the suite does not pay two real seconds for the
    // assertion that the deadline exists.
    const indicator = await indicatorOver(hangingPool());
    jest.useFakeTimers();

    try {
      const pending = indicator.check();
      await jest.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS);
      const reported = (await pending)[DATABASE_KEY] as Reported;

      expect(reported.status).toBe("down");
      expect(reported.message).toBe(`${PROBE_STATEMENT} timed out after ${PROBE_TIMEOUT_MS} ms`);
    } finally {
      jest.useRealTimers();
    }
  });

  it("never rejects, so a dependency being down is never mistaken for a broken probe", async () => {
    const throwing: FakeProbePool = {
      ...answeringPool(),
      query: () => {
        throw connectionRefused();
      },
    };

    await expect(report(throwing)).resolves.toEqual({
      status: "down",
      message: `${PROBE_STATEMENT} failed (ECONNREFUSED)`,
    });
  });

  it("tells the log what it will not tell the caller", async () => {
    const error = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);

    const reported = await report(refusingPool());

    // The host and port are in the log, where an operator reads them, and nowhere else.
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("failed (ECONNREFUSED)"),
      expect.stringContaining("127.0.0.1:5432"),
    );
    expect(JSON.stringify(reported)).not.toContain("127.0.0.1");
  });
});
