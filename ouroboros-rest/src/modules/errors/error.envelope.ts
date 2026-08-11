/**
 * The error envelope — one shape for every failure a client sees.
 *
 * `docs/ARCHITECTURE.md` § 5.3: `{code, message, details}`, from both services, for every
 * error. `code` is stable and machine-readable, `message` is written for a human, and
 * `details` carries whatever is specific to the failure — per-field validation output, the
 * value that collided, the constraint that refused.
 *
 * ```json
 * { "code": "domain_taken", "message": "That domain belongs to another tenant.", "details": {} }
 * ```
 *
 * Three decisions are made here rather than at the several hundred call sites that will
 * eventually throw:
 *
 *   * **The envelope *is* the exception's body.** {@link DomainError} extends Nest's
 *     `HttpException` and hands it the finished envelope, so the status and the body are
 *     decided together and a handler cannot throw one without the other. `error.filter.ts`
 *     then has nothing to construct for the errors this service raises deliberately — it
 *     only has to recognise the ones it did not.
 *   * **`details` is always an object, never absent.** A client that reads
 *     `error.details.fields` should not have to check whether `details` exists first, and a
 *     schema that made it optional would let two services disagree about the empty case.
 *   * **A 5xx never carries its own message.** The three subclasses below are all 4xx —
 *     failures a client caused and can act on. Anything else reaching the filter is a
 *     failure the *service* had, and its message names a table, a column, a host or a role;
 *     it goes to the log, and the client gets a constant string. That is the same rule
 *     `src/modules/health/` applies to a `down` message, for the same reason.
 */

import { HttpException, HttpStatus } from "@nestjs/common";

/**
 * What is specific to one failure.
 *
 * Open by construction: a validation failure fills it with `{field: [messages]}`, a
 * constraint violation with the value that collided, and a failure nobody has written yet
 * with whatever it needs. The specification documents it as an open object for exactly that
 * reason — a closed one would make every new detail a breaking change to the contract.
 */
export type ErrorDetails = Record<string, unknown>;

/** The body of every error response this service sends. */
export interface ErrorEnvelope {
  /** Stable, machine-readable, and the thing a client branches on. */
  code: string;
  /** For a human. Never a driver's message, a stack, or a constraint's name. */
  message: string;
  /** Whatever is specific to this failure. Empty rather than absent when there is none. */
  details: ErrorDetails;
}

/**
 * An error this service raised on purpose, carrying the envelope a client will read.
 *
 * Subclass rather than construct: {@link NotFoundError}, {@link ConflictError} and
 * {@link InvalidRequestError} are the three statuses the tenancy API answers with, and
 * naming one at a call site is what makes the status readable there. A caller that needs a
 * fourth adds a subclass here rather than passing a number through a service.
 */
export class DomainError extends HttpException {
  /**
   * @param status - The HTTP status this failure is.
   * @param code - The stable code. Lower-case, underscore-separated, and documented in
   *   `openapi.yaml` beside the operation that can answer with it — the document is the
   *   registry, so a code cannot be introduced without being described.
   * @param message - What a human reads. A complete sentence; it may name the value that
   *   was rejected, and may never name anything about the service's own internals.
   * @param details - Whatever is specific to this failure. Defaults to empty.
   */
  constructor(
    status: HttpStatus,
    readonly code: string,
    message: string,
    readonly details: ErrorDetails = {},
  ) {
    super({ code, message, details } satisfies ErrorEnvelope, status);
  }

  /**
   * The envelope, typed.
   *
   * @returns The body this error was constructed with. `HttpException.getResponse()`
   *   returns `string | object`, and every construction path above passes an envelope, so
   *   this is the narrowing rather than a cast at each reader.
   */
  envelope(): ErrorEnvelope {
    return super.getResponse() as ErrorEnvelope;
  }
}

/**
 * `404` — the thing addressed does not exist, or the caller may not know that it does.
 *
 * The second half matters once [#32](https://github.com/NobuData/ouroboros/issues/32) lands:
 * a tenant the caller is not a member of answers `404` rather than `403`, so the API does
 * not leak which identifiers exist to someone probing them.
 */
export class NotFoundError extends DomainError {
  constructor(code: string, message: string, details: ErrorDetails = {}) {
    super(HttpStatus.NOT_FOUND, code, message, details);
  }
}

/**
 * `409` — the request is well-formed and refers to things that exist, and the state refuses
 * it.
 *
 * A duplicate domain, a user who is already a member, the last owner of a tenant being
 * demoted. Distinct from `422` on purpose: nothing about the request is malformed, so a
 * client that retries it unchanged will get the same answer.
 */
export class ConflictError extends DomainError {
  constructor(code: string, message: string, details: ErrorDetails = {}) {
    super(HttpStatus.CONFLICT, code, message, details);
  }
}

/**
 * `422` — the request was understood and its content is not acceptable.
 *
 * This is what DTO validation answers with, rather than `400`: a `400` says "this is not a
 * request I can parse", which is what a malformed body or an unparseable query string is,
 * and conflating the two costs a client the ability to tell "I sent the wrong shape" from
 * "I sent the wrong value". The issue's own diagram names `422` for this case.
 */
export class InvalidRequestError extends DomainError {
  constructor(code: string, message: string, details: ErrorDetails = {}) {
    super(HttpStatus.UNPROCESSABLE_ENTITY, code, message, details);
  }
}

/**
 * The code for a failure that named none — an exception from the framework, or one from a
 * library that never heard of this envelope.
 *
 * Derived from the status rather than looked up in a table with a default, so a status this
 * service has never answered with still gets an honest code instead of `unknown_error`.
 *
 * @param status - The HTTP status of the failure.
 * @returns A stable code for it.
 */
export function codeForStatus(status: number): string {
  return GENERIC_CODES[status] ?? (status < SERVER_ERROR_FLOOR ? "bad_request" : "internal_error");
}

/**
 * The status at which a failure stops being the caller's and becomes the service's.
 *
 * Typed `number` rather than left as the enum member it is initialised from, deliberately:
 * the values compared against it are plain numbers off an exception, and the linter is right
 * that comparing one of those to an enum member is usually a mistake.
 */
export const SERVER_ERROR_FLOOR: number = HttpStatus.INTERNAL_SERVER_ERROR;

/**
 * Codes for the statuses the framework itself can produce.
 *
 * Nest answers `404` for a path no controller claims and `405`/`415`/`413` from its
 * pipeline before a handler is reached. None of those come from code in this repository, so
 * without this they would be the one class of error that did not carry a code — which is
 * the hole a client's `switch (error.code)` falls through.
 */
const GENERIC_CODES: Readonly<Record<number, string>> = Object.freeze({
  [HttpStatus.BAD_REQUEST]: "bad_request",
  [HttpStatus.UNAUTHORIZED]: "unauthenticated",
  [HttpStatus.FORBIDDEN]: "forbidden",
  [HttpStatus.NOT_FOUND]: "not_found",
  [HttpStatus.METHOD_NOT_ALLOWED]: "method_not_allowed",
  [HttpStatus.NOT_ACCEPTABLE]: "not_acceptable",
  [HttpStatus.CONFLICT]: "conflict",
  [HttpStatus.PAYLOAD_TOO_LARGE]: "payload_too_large",
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: "unsupported_media_type",
  [HttpStatus.UNPROCESSABLE_ENTITY]: "unprocessable_entity",
  [HttpStatus.TOO_MANY_REQUESTS]: "rate_limited",
  [HttpStatus.INTERNAL_SERVER_ERROR]: "internal_error",
  [HttpStatus.BAD_GATEWAY]: "bad_gateway",
  [HttpStatus.SERVICE_UNAVAILABLE]: "unavailable",
  [HttpStatus.GATEWAY_TIMEOUT]: "gateway_timeout",
});

/**
 * What a client is told when the service itself failed.
 *
 * Constant, deliberately. The real message names the query that failed, the column that was
 * missing or the host that refused a connection, and this route answers whoever asked — so
 * the diagnosis goes to the log, where an operator reads it, exactly as
 * `src/modules/health/` keeps a driver's text out of a probe's body.
 */
export const INTERNAL_ERROR_MESSAGE =
  "The service failed to handle this request. The failure has been logged.";
