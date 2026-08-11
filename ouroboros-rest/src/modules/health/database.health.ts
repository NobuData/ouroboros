/**
 * Is the database reachable? — the first half of `/health/ready`.
 *
 * One question, asked the cheapest way there is: `SELECT 1` on a connection of the probe's
 * own. It reports `up` when PostgreSQL answered and `down` with a classified reason when it
 * did not, and it never throws — an indicator that threw would be reported by Terminus as
 * a `500` on the probe itself, which tells whatever is polling that the *probe* is broken
 * rather than that the database is down.
 */

import { Inject, Injectable, Logger } from "@nestjs/common";
import { HealthIndicatorService, type HealthIndicatorResult } from "@nestjs/terminus";

import { DATABASE_PROBE_POOL, PROBE_STATEMENT, type ProbePool } from "./database.pool";
import { describeFailure, describeForLog, withTimeout } from "./probe";

/**
 * How this dependency is named in the response body.
 *
 * Issue [#29](https://github.com/NobuData/ouroboros/issues/29)'s acceptance criterion is
 * that stopping PostgreSQL flips `/health/ready` to a 503 *naming* `database`, so the key
 * is the deliverable rather than a label — hence a constant the suite asserts against.
 */
export const DATABASE_KEY = "database";

/** The database half of the readiness probe. */
@Injectable()
export class DatabaseHealthIndicator {
  /** Where the driver's own diagnosis goes. See `probe.ts` on why it goes only here. */
  private readonly logger = new Logger(DatabaseHealthIndicator.name);

  /**
   * @param pool - The probe's connection. Injected by token so
   *   [#30](https://github.com/NobuData/ouroboros/issues/30) can supply it from the
   *   service's own pool later, and so a test can supply a database that refuses.
   * @param indicators - Terminus's result builder, which is what makes `up`/`down` the
   *   only two shapes this class can produce.
   */
  constructor(
    @Inject(DATABASE_PROBE_POOL) private readonly pool: ProbePool,
    private readonly indicators: HealthIndicatorService,
  ) {}

  /**
   * Ask the database whether it is there.
   *
   * @returns `{database: {status: "up"}}`, or `{database: {status: "down", message}}` where
   *   the message is one of `probe.ts`'s classified phrases — `SELECT 1 failed
   *   (ECONNREFUSED)`, `SELECT 1 timed out after 2000 ms`. Never a rejected promise: every
   *   failure is a `down`, which is the answer a readiness probe is asking for.
   */
  async check(): Promise<HealthIndicatorResult> {
    const session = this.indicators.check(DATABASE_KEY);

    try {
      await withTimeout(this.pool.query(PROBE_STATEMENT));
      return session.up();
    } catch (error) {
      const outcome = `${PROBE_STATEMENT} ${describeFailure(error)}`;

      // The log gets the driver's diagnosis; the caller gets the classification. One line
      // each, both naming the same outcome, so a 503 can be found in the log.
      this.logger.error(`${outcome} against the database`, describeForLog(error));
      return session.down(outcome);
    }
  }
}
