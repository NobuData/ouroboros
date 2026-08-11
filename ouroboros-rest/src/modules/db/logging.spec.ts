import type { LogEvent } from "kysely";

import { SLOW_QUERY_MS, describeQuery, queryLogger, type QueryLogger } from "./logging";

/**
 * What a query is allowed to say in the log.
 *
 * Two rules, and the second one is the reason this file exists rather than a comment: the
 * parameters Kysely compiles out of a query are the users' data — an email address, a
 * display name, a tenant's identifiers — and a rendering that ever included them would be
 * a service writing personal data into a file nobody classifies as sensitive. Every
 * assertion below that mentions parameters is checking that rule from a different angle.
 */

/** A logger that records rather than prints, so a test can read what was written. */
function recordingLogger(): QueryLogger & {
  debugged: string[];
  errored: [string, string | undefined][];
} {
  const debugged: string[] = [];
  const errored: [string, string | undefined][] = [];

  return {
    debugged,
    errored,
    debug: (message) => debugged.push(message),
    error: (message, stack) => errored.push([message, stack]),
  };
}

/**
 * A query event, as Kysely reports one.
 *
 * @param overrides - What this event should differ in — normally its duration.
 * @returns A `query` event carrying a parameterised statement and one parameter.
 */
function queryEvent(overrides: { durationMs?: number; sql?: string } = {}): LogEvent {
  return {
    level: "query",
    queryDurationMillis: overrides.durationMs ?? 1,
    query: {
      sql: overrides.sql ?? 'select "id" from "ouroboros"."users" where "email" = $1',
      parameters: ["someone@example.com"],
      query: { kind: "SelectQueryNode" },
      queryId: { queryId: "test" },
    },
  };
}

/**
 * An error event, as Kysely reports one.
 *
 * @param error - What the driver threw.
 * @returns An `error` event over the same statement.
 */
function errorEvent(error: unknown): LogEvent {
  return { ...queryEvent({ durationMs: 12 }), level: "error", error };
}

describe("describeQuery", () => {
  it("reports the duration and the statement", () => {
    expect(describeQuery(queryEvent({ durationMs: 250 }))).toBe(
      '250 ms — select "id" from "ouroboros"."users" where "email" = $1',
    );
  });

  it("never reports the parameters", () => {
    // The whole rule, stated once: the SQL is a fact about the code, the parameters are
    // the data. Only the first is ever written.
    expect(describeQuery(queryEvent())).not.toContain("someone@example.com");
  });

  it("collapses a multi-line statement onto one line", () => {
    const described = describeQuery(queryEvent({ sql: 'select *\n  from "tenants"\n' }));

    expect(described).toBe('1 ms — select * from "tenants"');
  });

  it("rounds the duration, because a fraction of a millisecond is noise", () => {
    expect(describeQuery(queryEvent({ durationMs: 3.14159 }))).toMatch(/^3 ms — /);
  });
});

describe("queryLogger", () => {
  describe("in development", () => {
    it("reports a query slower than the threshold", () => {
      const logger = recordingLogger();

      queryLogger(logger, true)(queryEvent({ durationMs: SLOW_QUERY_MS }));

      expect(logger.debugged).toEqual([
        expect.stringContaining(`slow query — ${SLOW_QUERY_MS} ms`),
      ]);
    });

    it("says nothing about a query that was quick enough", () => {
      const logger = recordingLogger();

      queryLogger(logger, true)(queryEvent({ durationMs: SLOW_QUERY_MS - 1 }));

      expect(logger.debugged).toEqual([]);
    });

    it("takes the threshold it is given", () => {
      const logger = recordingLogger();

      queryLogger(logger, true, 10)(queryEvent({ durationMs: 11 }));

      expect(logger.debugged).toHaveLength(1);
    });

    it("still logs no parameters", () => {
      const logger = recordingLogger();

      queryLogger(logger, true)(queryEvent({ durationMs: 5000 }));

      expect(logger.debugged.join("\n")).not.toContain("someone@example.com");
    });
  });

  describe("in production", () => {
    it("says nothing about a successful query, however slow", () => {
      // Logging every statement at request volume would put the service's whole read
      // pattern into the log, and the slow ones are a development finding rather than an
      // operational event.
      const logger = recordingLogger();

      queryLogger(logger, false)(queryEvent({ durationMs: 60_000 }));

      expect(logger.debugged).toEqual([]);
    });

    it("still reports a query that failed", () => {
      const logger = recordingLogger();

      queryLogger(logger, false)(errorEvent(new Error("deadlock detected")));

      expect(logger.errored).toHaveLength(1);
    });
  });

  describe("when a query fails", () => {
    it("names the statement and how long it ran before failing", () => {
      const logger = recordingLogger();

      queryLogger(logger, true)(errorEvent(new Error("deadlock detected")));

      const [[message]] = logger.errored;
      expect(message).toContain("query failed after 12 ms");
      expect(message).toContain('from "ouroboros"."users"');
    });

    it("passes the driver's own diagnosis through as the stack", () => {
      const logger = recordingLogger();
      const failure = new Error("deadlock detected");

      queryLogger(logger, true)(errorEvent(failure));

      const [[, stack]] = logger.errored;
      expect(stack).toBe(failure.stack);
    });

    it("survives a throw that is not an Error", () => {
      // A `throw` is not obliged to throw an `Error`, and a logger that assumed otherwise
      // would fail while reporting a failure.
      const logger = recordingLogger();

      expect(() => queryLogger(logger, true)(errorEvent("connection terminated"))).not.toThrow();
      expect(logger.errored[0][1]).toBe("connection terminated");
    });

    it("reports an Error without a stack by name and message", () => {
      const logger = recordingLogger();
      const failure = new Error("no stack here");
      failure.stack = undefined;

      queryLogger(logger, true)(errorEvent(failure));

      expect(logger.errored[0][1]).toBe("Error: no stack here");
    });

    it("logs no parameters", () => {
      const logger = recordingLogger();

      queryLogger(logger, true)(errorEvent(new Error("deadlock detected")));

      expect(JSON.stringify(logger.errored)).not.toContain("someone@example.com");
    });
  });
});
