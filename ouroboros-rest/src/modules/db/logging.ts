/**
 * What a query is allowed to say in the log.
 *
 * Kysely reports every statement it runs and every one that failed. Two rules decide what
 * reaches the log, and both of them exist because the alternative is a service that writes
 * its users' data into a file nobody classifies as sensitive:
 *
 *   * **Parameters are never logged.** Kysely parameterises everything — a compiled query
 *     is `select … where email = $1` plus a separate list of values — and that list is the
 *     part that holds an email address, a display name, a GitHub login, a tenant's
 *     identifiers. The SQL text is a fact about the code; the parameters are the data. Only
 *     the first is ever written, which is a rule that cannot leak rather than a list of
 *     exceptions somebody has to maintain.
 *   * **Successful queries are logged only in development, and only when slow.** Logging
 *     every statement in production would put the whole read pattern of the service into
 *     the log at request volume. A statement over {@link SLOW_QUERY_MS} in development is
 *     the thing worth seeing — it is the missing index or the query in a loop, found while
 *     it is cheap to fix. Failures are logged in every environment: a statement that threw
 *     is a defect wherever it happens.
 */

import type { LogEvent } from "kysely";

/**
 * How long a query may take in development before it is worth a line in the log.
 *
 * Two hundred milliseconds is chosen against a person rather than against PostgreSQL: a
 * request that runs a handful of queries has a budget of a few hundred milliseconds in
 * total, so a single statement reaching this has either lost an index or is being asked
 * for more rows than a screen can use.
 */
export const SLOW_QUERY_MS = 200;

/** The logging surface {@link queryLogger} writes through — satisfied by Nest's `Logger`. */
export interface QueryLogger {
  /** A slow statement in development. Below the default log level in production. */
  debug(message: string): void;
  /** A statement that failed. */
  error(message: string, stack?: string): void;
}

/**
 * One line describing a query, with its parameters left out.
 *
 * Kysely's compiled SQL is written across as many lines as the builder produced; it is
 * collapsed here so one query is one log line and a log reader can still grep it.
 *
 * @param event - The event Kysely reported.
 * @returns The duration and the parameterised SQL — never the parameters.
 */
export function describeQuery(event: LogEvent): string {
  const sql = event.query.sql.replace(/\s+/g, " ").trim();

  return `${Math.round(event.queryDurationMillis)} ms — ${sql}`;
}

/**
 * Build the function Kysely reports every query and every failure to.
 *
 * @param logger - Where lines are written. Injected rather than constructed so a suite can
 *   read what was logged without a logger's own output rules getting in the way.
 * @param isDevelopment - Whether slow *successful* queries are reported at all. Failures
 *   are reported regardless; see this module's header.
 * @param thresholdMs - How slow is worth reporting. Defaults to {@link SLOW_QUERY_MS}.
 * @returns A `LogEvent` handler for `KyselyConfig.log`.
 */
export function queryLogger(
  logger: QueryLogger,
  isDevelopment: boolean,
  thresholdMs: number = SLOW_QUERY_MS,
): (event: LogEvent) => void {
  return (event: LogEvent): void => {
    if (event.level === "error") {
      // The error itself goes in the stack argument, where Nest prints it beneath the
      // message: the SQL says which statement, the error says what PostgreSQL made of it.
      logger.error(`query failed after ${describeQuery(event)}`, describeError(event.error));
      return;
    }

    if (isDevelopment && event.queryDurationMillis >= thresholdMs) {
      logger.debug(`slow query — ${describeQuery(event)}`);
    }
  };
}

/**
 * A failure, as the log is allowed to report it.
 *
 * `pg` puts the offending statement, the constraint and the position in an error's own
 * fields, all of which an operator reading the service log is entitled to. This is
 * therefore *not* the redacted rendering `src/modules/health/probe.ts` produces — that one
 * exists because a health probe answers without authentication, and nothing here reaches a
 * caller.
 *
 * @param error - Whatever Kysely caught, which is not obliged to be an `Error`.
 * @returns Its stack when it has one, and the value rendered when it does not.
 */
function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? `${error.name}: ${error.message}`;
  }

  return String(error);
}
