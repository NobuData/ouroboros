/**
 * What both dependency probes share: a deadline, and what they are allowed to say.
 *
 * Two rules live here because they are the two ways a readiness probe goes wrong.
 *
 *   * **A probe is bounded.** `/health/ready` is polled by a healthcheck that has its own
 *     timeout, and a probe that can hang turns "the database is slow" into "the container
 *     never answered", which is a different diagnosis and, under an orchestrator, a
 *     restart loop. Every wait in this module is capped by {@link PROBE_TIMEOUT_MS} —
 *     issue [#29](https://github.com/NobuData/ouroboros/issues/29)'s third acceptance
 *     criterion.
 *   * **A probe does not narrate.** `/health/ready` answers *without authentication*,
 *     because whatever polls it holds no session. A driver's own error text is written for
 *     an operator reading a server log: it carries the host, the port and the role it
 *     failed to reach with, and a connection string's password sits one field away from
 *     all three. So {@link describeFailure} classifies a failure into a fixed phrase and
 *     at most a symbolic error code, the indicators log the real error where only an
 *     operator can read it, and the body names the dependency — which is what the issue
 *     asks for and all a probe's reader can act on anyway.
 *
 * *Reading* a thrown thing — its code, its `cause`, its stack — is `errors/failure.ts`,
 * which the engine gateway does too ([#35](https://github.com/NobuData/ouroboros/issues/35)).
 * What stays here is the half that is about a probe: the deadline, and the rule about what
 * may be said to a reader holding no session.
 */

import { failureCode } from "../errors/failure";

/**
 * How long either dependency probe waits before calling a dependency down.
 *
 * Two seconds is chosen against the caller rather than against the database: compose
 * healthchecks in this repository poll on a 2–3 second timeout
 * (`docker-compose.yml`), so a probe that waited longer would be killed by its reader
 * and report nothing at all. A dependency that cannot answer `SELECT 1` in two seconds
 * is not one this service can serve a request from either.
 */
export const PROBE_TIMEOUT_MS = 2000;

/**
 * A probe gave up waiting.
 *
 * Distinct from every other failure so {@link describeFailure} can say *timed out* rather
 * than *failed* — "the dependency is slow" and "the dependency refused us" are different
 * problems with different fixes, and it is the only distinction a probe's body draws.
 */
export class ProbeTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`the probe gave up after ${timeoutMs} ms`);
    this.name = "ProbeTimeoutError";
  }
}

/**
 * Race a probe against its deadline.
 *
 * The timer is always cleared, including when the work wins: a probe runs on every poll,
 * and a stray two-second timer per poll would keep the event loop busy and hold a test
 * runner open after its assertions were done.
 *
 * Whatever `work` is still doing is *not* cancelled — nothing here can cancel a query
 * mid-flight — so the driver's own timeouts are configured as well (see
 * `database.pool.ts`), and this is the guarantee that the *answer* is bounded rather than
 * the guarantee that the socket is.
 *
 * @param work - The probe already in flight.
 * @param timeoutMs - The deadline. Defaults to {@link PROBE_TIMEOUT_MS}.
 * @returns Whatever `work` resolved to, if it resolved in time.
 * @throws {ProbeTimeoutError} If the deadline passed first.
 * @throws Whatever `work` rejected with, unchanged, if it lost to nothing.
 */
export async function withTimeout<T>(
  work: Promise<T>,
  timeoutMs: number = PROBE_TIMEOUT_MS,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new ProbeTimeoutError(timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Shape of the symbolic code a driver or the runtime hangs on a failure. */
const CODE_PATTERN = /^[A-Z0-9_]{1,32}$/;

/**
 * The code a failure carries, if it carries one fit to *publish*.
 *
 * `pg` reports `ECONNREFUSED` on a closed port and a five-character `SQLSTATE` such as
 * `28P01` on a rejected login; `fetch` wraps the same class of failure in a `TypeError`
 * and hangs the code on `cause`, which is why the lookup is `errors/failure.ts`'s rather
 * than this file's. Both are worth having in the probe's body — they are the difference
 * between "nothing is listening" and "something is listening and said no" — and neither
 * names a host, a port, a role or a secret.
 *
 * The pattern is the safeguard rather than the lookup, and it is the part that belongs
 * here: this body answers an unauthenticated reader, so anything that is not a short
 * uppercase token is a message in disguise and is dropped rather than forwarded.
 *
 * @param error - Whatever was caught.
 * @returns The code, or `undefined` when there is none fit to publish.
 */
function publishableCode(error: unknown): string | undefined {
  const code = failureCode(error);

  return code !== undefined && CODE_PATTERN.test(code) ? code : undefined;
}

/**
 * Was this failure a deadline rather than a refusal?
 *
 * Both deadlines this module can hit are recognised: {@link withTimeout}'s own, and the
 * `TimeoutError` an `AbortSignal.timeout()` aborts a `fetch` with. The abort is matched by
 * its `name` and nothing else — it arrives as a `DOMException`, which Node does *not* make an
 * `instanceof Error`, so a check written against `Error` would silently report every timed-out
 * engine probe as a plain failure.
 *
 * @param error - Whatever was caught.
 * @returns `true` when the probe ran out of time.
 */
function isTimeout(error: unknown): boolean {
  if (error instanceof ProbeTimeoutError) {
    return true;
  }

  return typeof error === "object" && error !== null && "name" in error
    ? error.name === "TimeoutError"
    : false;
}

/**
 * A failure, as a probe is allowed to report it to an unauthenticated caller.
 *
 * @param error - Whatever was caught.
 * @returns One of `timed out after 2000 ms`, `failed (ECONNREFUSED)` or `failed` — never
 *   a driver's own message. See this module's header for why.
 */
export function describeFailure(error: unknown): string {
  if (isTimeout(error)) {
    return `timed out after ${PROBE_TIMEOUT_MS} ms`;
  }

  const code = publishableCode(error);
  return code === undefined ? "failed" : `failed (${code})`;
}
