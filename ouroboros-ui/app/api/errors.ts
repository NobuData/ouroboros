/**
 * The one error type every API call fails with.
 *
 * `ouroboros-rest` answers **every** failure with the same envelope —
 * `{code, message, details}` — from every operation and from the framework behind it
 * (`docs/ARCHITECTURE.md` § 5, `ouroboros-rest/openapi.yaml` § `components.schemas.Error`).
 * That is a promise worth spending a class on: a caller branches on `code`, shows
 * `message` to a person, and reads `details` for the specifics, without a `try` that
 * first has to work out which layer produced the body it is holding.
 *
 * The envelope type is the **generated** one, so a change to the contract's error shape
 * breaks this file's typecheck rather than being discovered in a browser.
 *
 * What this deliberately does *not* wrap: a fetch that never reached the service. A DNS
 * failure or a dropped connection rejects with the runtime's own `TypeError`, and turning
 * that into an `ApiError` would give a caller a `code` no service ever sent and cost the
 * original stack. "The request failed" and "the service refused the request" are
 * different facts, and only the second one has an envelope.
 */

import type { components } from "@/app/api/schema";

/** The error body of every operation, exactly as the contract declares it. */
export type ErrorEnvelope = components["schemas"]["Error"];

/** What the contract calls a session that is absent, expired, or not honoured. */
export const UNAUTHENTICATED_CODE = "unauthenticated";

/**
 * The `code` used when a failure carried no envelope this client could read.
 *
 * The `client_` prefix is the point: every code the service can answer with is named in
 * the specification, so a code that is not in it must be visibly this client's own —
 * a caller branching on `code` is never told the service said something it did not.
 */
export const UNREADABLE_ERROR_CODE = "client_unreadable_error";

/**
 * A failure `ouroboros-rest` answered with, carrying the envelope it sent.
 *
 * @property status The HTTP status. `code` is what to branch on; this is for logs and
 *   for the few decisions that really are about the status (a `401` routes to login).
 * @property code The contract's stable, machine-readable code, or
 *   {@link UNREADABLE_ERROR_CODE} when the body was not an envelope.
 * @property details Whatever was specific to this failure — a `422`'s messages keyed by
 *   field path, the identifier a `404` was asked about. Always an object, empty rather
 *   than absent, so `error.details.slug` never needs a guard on `details` first.
 * @property url The request that failed, for the log line. It carries no credentials:
 *   the session travels in a cookie and the workspace in a header, neither of which is
 *   part of a URL.
 */
export class ApiError extends Error {
  readonly name = "ApiError";

  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: ErrorEnvelope["details"] = {},
    readonly url?: string,
  ) {
    super(message);
  }

  /** Whether this is the one failure that means *sign in again* (`401`). */
  get isUnauthenticated(): boolean {
    return this.status === 401;
  }

  /**
   * Read a failed response as the contract's error envelope.
   *
   * The body is read from a **clone**, so the caller's response is left unconsumed and
   * anything downstream — a middleware, a log — can still read it.
   *
   * A body that is not an envelope is not an error to throw about: the caller is already
   * handling a failure, and a parse error raised while explaining a `502` from a proxy
   * would replace the fact that matters with the fact that a proxy does not speak this
   * contract. So the status is kept, the code becomes
   * {@link UNREADABLE_ERROR_CODE}, and the message says what was received.
   *
   * @param response The failed response. Its status is used whatever the body says.
   * @returns The error to throw.
   */
  static async fromResponse(response: Response): Promise<ApiError> {
    let body: unknown;
    try {
      body = await response.clone().json();
    } catch {
      body = undefined;
    }

    if (isErrorEnvelope(body)) {
      return new ApiError(
        response.status,
        body.code,
        body.message,
        body.details ?? {},
        response.url || undefined,
      );
    }

    return new ApiError(
      response.status,
      UNREADABLE_ERROR_CODE,
      `ouroboros-rest answered ${response.status}${
        response.statusText ? ` ${response.statusText}` : ""
      } with a body this client could not read as an error envelope.`,
      {},
      response.url || undefined,
    );
  }
}

/**
 * Whether a parsed body is the contract's error envelope.
 *
 * Structural rather than exhaustive: `code` and `message` are what a caller acts on, and
 * a body carrying both is an envelope for every purpose this client has. `details` is
 * required by the contract but tolerated as missing here, because inventing an empty
 * object is a better answer than discarding a real `code` over a field nobody read.
 *
 * @param value A parsed response body.
 * @returns `true` when it can be read as an {@link ErrorEnvelope}.
 */
export function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<ErrorEnvelope>;
  return typeof candidate.code === "string" && typeof candidate.message === "string";
}

/**
 * Whether a caught value is an {@link ApiError}.
 *
 * A `catch` binds `unknown`, and this is the guard that narrows it — `instanceof` at the
 * call site would be one more place that has to import the class.
 *
 * @param value Anything caught.
 * @returns `true` when it is an {@link ApiError}.
 */
export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}
