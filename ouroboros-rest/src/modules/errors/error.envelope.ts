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
 *   * **No message a client reads was written by something else.** The 4xx subclasses
 *     below are failures a client caused and can act on, and their messages are written
 *     for whoever caused them. A failure the *service* had names a table, a column, a host
 *     or a role; it goes to the log, and the client gets a constant string. That is the
 *     same rule `src/modules/health/` applies to a `down` message, for the same reason.
 *     {@link UpstreamError} is the one 5xx that carries a message, and it does not
 *     contradict this: its text is a constant in this repository saying which dependency
 *     failed, never a repetition of what that dependency said.
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
 * Subclass rather than construct: {@link BadRequestError}, {@link UnauthenticatedError},
 * {@link ForbiddenError}, {@link NotFoundError}, {@link ConflictError},
 * {@link InvalidRequestError} and
 * {@link UpstreamError} are the statuses this API answers with, and naming one at a call
 * site is what makes the status readable there. A caller that needs another adds a subclass
 * here rather than passing a number through a service.
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
 * `401` — this request carries no session, or one this service will not honour.
 *
 * The distinction from `403` is *who* is asking rather than *what* they asked for: a `401`
 * says nobody is signed in and signing in may help, and it is what the global session
 * guard answers ([#33](https://github.com/NobuData/ouroboros/issues/33)). A signed-in
 * caller who may not do something gets `403` — or, when telling them the thing exists
 * would itself be a leak, the `404` below
 * ([#32](https://github.com/NobuData/ouroboros/issues/32)).
 *
 * Every way a session can fail — absent, forged, expired, signed with a rotated key,
 * naming a user who has since been deleted — is this one answer with this one code. A
 * client cannot act differently on any of them, and an API that distinguished them would
 * be telling whoever is probing it which part of their forgery was right.
 */
export class UnauthenticatedError extends DomainError {
  constructor(code: string, message: string, details: ErrorDetails = {}) {
    super(HttpStatus.UNAUTHORIZED, code, message, details);
  }
}

/**
 * `502` — a service this one depends on failed, and the request cannot be answered without
 * it.
 *
 * The one class here that is not the caller's fault. It exists because "GitHub refused the
 * code exchange" is not a `500`: this service is working, the request was well-formed, and
 * retrying is a reasonable thing for a client to do — which is exactly what `502` says and
 * `500` does not. Its message names the dependency and nothing else: a body echoing what
 * an upstream said would publish that upstream's error strings, which are not this API's
 * contract and have carried tokens before now.
 */
export class UpstreamError extends DomainError {
  constructor(code: string, message: string, details: ErrorDetails = {}) {
    super(HttpStatus.BAD_GATEWAY, code, message, details);
  }
}

/**
 * `403` — the caller is who they say they are, and may not do this.
 *
 * Narrower than it looks, and the narrowness is the point. This API answers `403` only when
 * the caller has *already* proved they can see the thing they are acting on — a member of a
 * tenant whose role is too low ([#32](https://github.com/NobuData/ouroboros/issues/32)).
 * Anywhere the caller's right to know a thing exists is itself in question, the answer is
 * {@link NotFoundError}, because a `403` confirms that an identifier names something real
 * and that is the whole of what somebody enumerating identifiers is trying to learn.
 */
export class ForbiddenError extends DomainError {
  constructor(code: string, message: string, details: ErrorDetails = {}) {
    super(HttpStatus.FORBIDDEN, code, message, details);
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
 * `400` — the request cannot be acted on as it stands, and the caller has to change
 * something *about the request* before it can be.
 *
 * Deliberately narrow, and distinct from {@link InvalidRequestError} on the axis that file's
 * `422` is chosen for: a `422` says *this value is not acceptable* and names the field, while
 * this says *the request is missing a thing no field of it carries*. The one case today is
 * [#713](https://github.com/NobuData/ouroboros/issues/713)'s `organization_required` — the
 * session names no active workspace and the request named none either, so there is no field
 * to complain about and nothing about the body is wrong. A `422` there would send a UI
 * looking for `details.fields` that will never be populated; a `404` would be a lie about
 * something existing. The action is *choose a workspace*, and `400` with a code that says so
 * is the answer a client can act on.
 */
export class BadRequestError extends DomainError {
  constructor(code: string, message: string, details: ErrorDetails = {}) {
    super(HttpStatus.BAD_REQUEST, code, message, details);
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
 * `429` — the caller may do this, and has done it too often to be allowed another one now.
 *
 * Distinct from {@link ForbiddenError} on the axis that matters to whoever reads it: a `403`
 * is about *who* is asking and never becomes a `200` by waiting, and this one is about *how
 * often* and becomes a `200` by waiting exactly as long as `details.retryAfterSeconds` says.
 *
 * It exists for AD.2 ([#223](https://github.com/NobuData/ouroboros/issues/223))'s reveal,
 * which is the one operation in this API that answers with a live credential: an endpoint
 * that hands one back is an endpoint worth taking one attempt at a time, and *rate-limited
 * per user and per connection* is that ticket's acceptance criterion. `codeForStatus` has
 * spelled the generic version `rate_limited` since #33 — this is the deliberate half, whose
 * code names which limit was reached.
 *
 * **`details.retryAfterSeconds` is a number rather than a `Retry-After` header**, because
 * this service's contract is the envelope: a client that already branches on
 * `error.details` should not need a second reader for a header to learn the one fact that
 * makes the refusal actionable. Nothing stops a future caller adding the header too; what
 * would be wrong is having only the header.
 */
export class TooManyRequestsError extends DomainError {
  constructor(code: string, message: string, details: ErrorDetails = {}) {
    super(HttpStatus.TOO_MANY_REQUESTS, code, message, details);
  }
}

/**
 * `501` — this operation is a published contract that nothing implements yet.
 *
 * The only class here above the {@link SERVER_ERROR_FLOOR}, and the only one whose message
 * a caller is allowed to read. Everything else in the 5xx range is a failure whose text is
 * kept inside the process — `error.filter.ts` replaces it with
 * {@link INTERNAL_ERROR_MESSAGE}, because a status somebody chose and a message somebody
 * wrote for a client are different things and a stack trace is neither. A `DomainError`
 * *is* the answer, so this one keeps what it was constructed with, and that is the whole
 * reason it is a subclass rather than a `throw new HttpException(…, 501)`.
 *
 * It exists for the shape AD.3 ([#224](https://github.com/NobuData/ouroboros/issues/224))
 * introduces: a surface specified in one ticket and implemented in another, where the
 * contract has to be callable before it can be built against. A `404` would be
 * indistinguishable from a caller with the path wrong, which is the one thing an
 * implementer of the other half needs to be able to rule out.
 */
export class NotImplementedError extends DomainError {
  constructor(code: string, message: string, details: ErrorDetails = {}) {
    super(HttpStatus.NOT_IMPLEMENTED, code, message, details);
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
  [HttpStatus.NOT_IMPLEMENTED]: "not_implemented",
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
