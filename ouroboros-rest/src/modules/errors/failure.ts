/**
 * How a thrown thing is read, and how it is written down for an operator.
 *
 * Three services' worth of failures pass through this service — PostgreSQL's, GitHub's,
 * `ouroboros-engine`'s — and each of them arrives as something a `catch` bound: an `Error`
 * with a `code`, a `TypeError` from `fetch` wrapping the real failure in `cause`, a
 * `DOMException` from an abort, or a value that is none of those, because a `throw` is not
 * obliged to throw an `Error`. Reading one is the same job every time, and it lives here
 * rather than in each module that does it.
 *
 * It sits in `errors/` deliberately. That directory holds what is true of *every* failure —
 * the envelope a client reads, and now the counterpart: what the log gets instead. The two
 * are the same decision seen from both ends, because the reason a client's message is a
 * constant is that everything specific is in here.
 *
 * **Nothing in this file is fit to publish.** A driver's message carries the host, the port
 * and the role it failed to reach with; a connection string's password sits one field away
 * from all three. What may appear in a response body is decided by the caller —
 * `health/probe.ts` classifies a failure into a fixed phrase for an unauthenticated reader,
 * and `engine/engine.errors.ts` answers one constant — and this is what those callers keep
 * *out* of it.
 */

/**
 * The `cause` a value carries, if any.
 *
 * @param error - Whatever was caught.
 * @returns Its `cause`, or `undefined`. `fetch` puts the real failure there: a request that
 *   could not connect is a `TypeError` reading "fetch failed" whose cause is the
 *   `ECONNREFUSED` that actually happened.
 */
export function causeOf(error: unknown): unknown {
  return typeof error === "object" && error !== null && "cause" in error ? error.cause : undefined;
}

/**
 * The `code` a single value carries, if it carries a string one.
 *
 * @param candidate - An error, or an error's `cause`.
 * @returns The code, unfiltered — `ECONNREFUSED`, a five-character `SQLSTATE` such as
 *   `28P01`, or whatever else a library hung there. A caller that puts one in a *response*
 *   filters it first; see `health/probe.ts`, which requires a short uppercase token because
 *   anything else is a message in disguise.
 */
export function codeOf(candidate: unknown): string | undefined {
  if (typeof candidate !== "object" || candidate === null || !("code" in candidate)) {
    return undefined;
  }

  const { code } = candidate;
  return typeof code === "string" ? code : undefined;
}

/**
 * The code a failure carries, looking through the wrapper `fetch` reports one in.
 *
 * @param error - Whatever was caught.
 * @returns The code on the error itself, or failing that the one on its `cause`, or
 *   `undefined` when there is none.
 */
export function failureCode(error: unknown): string | undefined {
  return codeOf(error) ?? codeOf(causeOf(error));
}

/** How many `cause` links {@link describeForLog} follows. See its notes on cycles. */
const MAXIMUM_CAUSE_DEPTH = 3;

/**
 * A failure, as the service log is allowed to report it.
 *
 * The counterpart of whatever the caller decides to *say*: an operator reading the log is
 * the one person entitled to the driver's own diagnosis, and without this the classified
 * phrase in a response body would be the only record of what went wrong.
 *
 * The `cause` chain is followed, because for `fetch` it is the whole diagnosis and
 * `Error.stack` does not include it. Following it is bounded at
 * {@link MAXIMUM_CAUSE_DEPTH}: a cause chain is data from a library, and an error whose
 * cause is itself would otherwise turn a log line into a stack overflow.
 *
 * @param error - Whatever was caught.
 * @param depth - How many links have been followed. Callers leave this alone.
 * @returns The error's stack when it has one, its name and message when it does not, or the
 *   value itself rendered, followed by `caused by …` for each cause.
 */
export function describeForLog(error: unknown, depth = 0): string {
  const described =
    error instanceof Error ? (error.stack ?? `${error.name}: ${error.message}`) : String(error);

  const cause = causeOf(error);
  if (cause === undefined || depth >= MAXIMUM_CAUSE_DEPTH) {
    return described;
  }

  return `${described}\ncaused by ${describeForLog(cause, depth + 1)}`;
}
