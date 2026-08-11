/**
 * Dependencies that answer, refuse, or never come back — without a database or an engine.
 *
 * A readiness probe is only interesting when its dependencies misbehave, and the three ways
 * they misbehave are the three helpers here. They live in a fixture rather than in one
 * spec file because the indicator suite and the controller suite need the same fakes: one
 * asks what the indicator returns, the other asks what the HTTP surface does with it.
 *
 * Not shipped — `tsconfig.build.json` excludes `*.fixture.ts` alongside the specs.
 */

import type { ProbePool } from "./database.pool";

/** A {@link ProbePool} with the statements it was asked for recorded. */
export interface FakeProbePool extends ProbePool {
  /** Every statement {@link ProbePool.query} was asked to run, in order. */
  readonly statements: string[];
}

/**
 * A database that answers.
 *
 * @returns A pool whose `query` resolves immediately.
 */
export function answeringPool(): FakeProbePool {
  return poolWith(() => Promise.resolve());
}

/**
 * A database that is not there.
 *
 * @param error - What the driver reports. Defaults to what `pg` reports for a closed
 *   port, `code` and all, because that is the failure the issue's acceptance criterion
 *   describes: PostgreSQL stopped.
 * @returns A pool whose `query` rejects.
 */
export function refusingPool(error: Error = connectionRefused()): FakeProbePool {
  return poolWith(() => Promise.reject(error));
}

/**
 * A database that accepted the question and never answered.
 *
 * The returned promise is never settled, which is the point: it is what proves the probe's
 * own deadline is what ends the wait. Nothing has to clean it up — an unsettled promise
 * holds no timer and no socket.
 *
 * @returns A pool whose `query` hangs forever.
 */
export function hangingPool(): FakeProbePool {
  return poolWith(() => new Promise<void>(() => undefined));
}

/**
 * The error `pg` raises when nothing is listening on the configured port.
 *
 * Written out rather than imported because `pg` does not export it, and because the thing
 * under test is the `code` — `probe.ts` publishes that and suppresses everything else.
 *
 * @returns An error shaped like the driver's, carrying a host and a port that must not
 *   reach a response body.
 */
export function connectionRefused(): Error & { code: string } {
  return Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), {
    code: "ECONNREFUSED",
  });
}

/**
 * Assemble a fake pool around one behaviour.
 *
 * @param query - What `query` does, called once per statement.
 * @returns The fake, with every statement it was asked for recorded.
 */
function poolWith(query: () => Promise<void>): FakeProbePool {
  const statements: string[] = [];

  return {
    statements,
    query: (sql: string) => {
      statements.push(sql);
      return query();
    },
    end: () => Promise.resolve(),
  };
}

/**
 * Replace `fetch` for the duration of a test.
 *
 * `globalThis.fetch` rather than an injected client: the engine probe is one request with a
 * deadline, so the thing worth asserting is that it really is a `fetch` with an abort
 * signal — and a seam invented to make that observable would be a seam the production path
 * does not use. Jest's `restoreMocks` puts the real one back.
 *
 * @param respond - What the request resolves or rejects with, given the URL it was called
 *   with.
 * @returns The spy, so a test can read the URL and the options it was called with.
 */
export function stubFetch(
  respond: (url: string) => Promise<Response>,
): jest.SpiedFunction<typeof fetch> {
  return jest
    .spyOn(globalThis, "fetch")
    .mockImplementation((input) => respond(requestedUrl(input)));
}

/**
 * The URL a `fetch` call was made with, whichever of its three forms was used.
 *
 * @param input - The first argument `fetch` received.
 * @returns The URL as a string.
 */
function requestedUrl(input: string | URL | Request): string {
  if (typeof input === "string") {
    return input;
  }

  return input instanceof URL ? input.toString() : input.url;
}

/**
 * An engine that answers `GET /healthz` the way it does today.
 *
 * @param status - The status to answer with. Defaults to `200`.
 * @returns A real `Response`, so the probe's body handling is exercised rather than mocked.
 */
export function engineResponse(status = 200): Response {
  return new Response(JSON.stringify({ status: "ok" }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * The failure `fetch` raises when nothing is listening.
 *
 * Shaped as undici shapes it — a `TypeError` whose `cause` carries the code — because
 * looking through that wrapper is precisely what `probe.ts` has to get right.
 *
 * @returns The error `fetch` rejects with.
 */
export function fetchRefused(): TypeError {
  return new TypeError("fetch failed", { cause: connectionRefused() });
}

/**
 * The failure `fetch` raises when `AbortSignal.timeout()` fires.
 *
 * @returns A `TimeoutError`, as the runtime raises it.
 */
export function fetchTimedOut(): DOMException {
  return new DOMException("The operation was aborted due to timeout", "TimeoutError");
}
