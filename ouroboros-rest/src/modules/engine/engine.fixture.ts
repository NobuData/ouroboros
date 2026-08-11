/**
 * An engine that answers, refuses, hangs or is not there — without an engine.
 *
 * The client takes its `fetch` as a constructor parameter (`engine.client.ts`), so every
 * spec here drives a real `EngineClient` against a function rather than a network. What
 * that buys is the assertions that matter for a gateway: which URL was called, which
 * headers went with it, how many attempts were made, and what a caller is told when none of
 * them worked.
 *
 * The failure shapes are undici's, written out rather than provoked. `health/probe.fixture.ts`
 * has one of them for the readiness probe; this file has the *set*, keyed by code, because
 * what is under test here is the rule about which codes are worth a second attempt — and
 * that rule is only observable if a spec can produce a failure per code.
 *
 * Not shipped — `tsconfig.build.json` excludes `*.fixture.ts` alongside the specs.
 */

/**
 * What `fetch` rejects with when a request does not produce an answer.
 *
 * `Error` covers undici's `TypeError`; `DOMException` is what an `AbortSignal.timeout()`
 * raises, and Node does *not* make one an `instanceof Error` — which is the distinction the
 * client's retry rule has to get right, so a fixture that could not produce one could not
 * exercise it.
 */
export type TransportFailure = Error | DOMException;

/** One recorded call: everything a spec might want to assert about a request. */
export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
  signal: AbortSignal | undefined;
}

/** A `fetch` stand-in, with the calls made through it. */
export interface FakeFetch {
  (input: string | URL | Request, init?: RequestInit): Promise<Response>;
  /** Every call, in order. */
  readonly calls: RecordedCall[];
}

/**
 * A `fetch` that answers whatever the given function says, and records what it was asked.
 *
 * @param respond - What to answer, given how many calls have already been made (1-based).
 *   Returning a `Response` answers; throwing, or returning a rejected promise, is the
 *   transport failing.
 * @returns The stand-in, with a `calls` array a spec reads afterwards.
 */
export function fakeFetch(respond: (attempt: number) => Promise<Response>): FakeFetch {
  const calls: RecordedCall[] = [];

  const implementation = async (input: string | URL | Request, init: RequestInit = {}) => {
    calls.push({
      url: requestedUrl(input),
      method: (init.method ?? "GET").toUpperCase(),
      headers: (init.headers ?? {}) as Record<string, string>,
      body: typeof init.body === "string" ? init.body : undefined,
      signal: init.signal ?? undefined,
    });

    return respond(calls.length);
  };

  return Object.assign(implementation, { calls });
}

/**
 * The URL a call was made with, whichever of `fetch`'s three forms was used.
 *
 * @param input - The first argument the client passed.
 * @returns The URL as a string.
 */
function requestedUrl(input: string | URL | Request): string {
  if (typeof input === "string") {
    return input;
  }

  return input instanceof URL ? input.toString() : input.url;
}

/**
 * A `fetch` that answers the same thing every time.
 *
 * @param response - What to answer, built per call so a body is never read twice.
 * @returns The stand-in.
 */
export function alwaysAnswering(response: () => Response): FakeFetch {
  return fakeFetch(() => Promise.resolve(response()));
}

/**
 * A `fetch` that fails every time.
 *
 * @param error - What to reject with, built per call.
 * @returns The stand-in.
 */
export function alwaysFailing(error: () => TransportFailure): FakeFetch {
  return fakeFetch(() => Promise.reject(error()));
}

/**
 * A `fetch` that fails once and then answers — an engine that was being replaced.
 *
 * @param error - What the first attempt rejects with.
 * @param response - What the second attempt answers.
 * @returns The stand-in.
 */
export function failingThenAnswering(
  error: () => TransportFailure,
  response: () => Response,
): FakeFetch {
  return fakeFetch((attempt) =>
    attempt === 1 ? Promise.reject(error()) : Promise.resolve(response()),
  );
}

/**
 * The failure undici raises for a transport problem: the wrapper, and the real cause.
 *
 * @param code - The `errno` code the cause carries — `ECONNREFUSED` for a closed port,
 *   `ENOTFOUND` for a name that does not resolve, `ECONNRESET` for a connection dropped
 *   after it was established.
 * @returns The error `fetch` rejects with.
 */
export function connectFailure(code: string): TypeError {
  return new TypeError("fetch failed", {
    cause: Object.assign(new Error(`connect ${code} 10.0.0.7:8000`), { code }),
  });
}

/**
 * The failure `AbortSignal.timeout()` aborts a `fetch` with.
 *
 * A `DOMException`, which Node does *not* make an `instanceof Error` — so a retry rule
 * written against `Error` would quietly treat a deadline as unclassifiable.
 *
 * @returns The error `fetch` rejects with when the deadline passes.
 */
export function timedOut(): DOMException {
  return new DOMException("The operation was aborted due to timeout", "TimeoutError");
}

/** What the engine's `GET /v0/status` really answers. */
export const ENGINE_STATUS_BODY = {
  service: "ouroboros-engine",
  version: "0.3.0",
  uptime_seconds: 1234.567,
};

/**
 * A `200` carrying a JSON body, as the engine sends one.
 *
 * @param body - What to answer with. Defaults to a well-formed status.
 * @returns A real `Response`, so the client's own parsing is exercised rather than mocked.
 */
export function jsonResponse(body: unknown = ENGINE_STATUS_BODY): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/**
 * A failure the engine answered with, in its own error envelope.
 *
 * The body is what `ouroboros-engine` really sends, and the point of most specs using it is
 * that **none of it** reaches the caller of this service.
 *
 * @param status - The status to answer with.
 * @param code - The engine's error code.
 * @returns A real `Response`.
 */
export function engineError(status: number, code = "unauthenticated"): Response {
  return new Response(JSON.stringify({ code, message: "Unauthorized.", details: {} }), {
    status,
    headers: { "content-type": "application/json" },
  });
}
