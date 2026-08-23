import { HttpStatus } from "@nestjs/common";

import {
  ConflictError,
  DomainError,
  INTERNAL_ERROR_MESSAGE,
  InvalidRequestError,
  NotImplementedError,
  NotFoundError,
  SERVER_ERROR_FLOOR,
  codeForStatus,
} from "./error.envelope";

/**
 * The envelope, as a shape a client can rely on.
 *
 * Everything here is about one promise: that `{code, message, details}` is what comes back,
 * with all three fields present, whatever produced the failure. The interesting cases are
 * the ones where a field could plausibly be missing — `details` on an error nobody gave any
 * — and the ones where the status is derived rather than stated.
 */

describe("a domain error", () => {
  it("carries the envelope as its body", () => {
    const error = new DomainError(HttpStatus.CONFLICT, "domain_taken", "Taken.", { domain: "x" });

    expect(error.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(error.envelope()).toEqual({
      code: "domain_taken",
      message: "Taken.",
      details: { domain: "x" },
    });
  });

  it("has empty details rather than none", () => {
    // A client reading `error.details.field` should never have to check `details` first,
    // and a schema that made it optional would let two services disagree about the empty
    // case.
    const error = new DomainError(HttpStatus.CONFLICT, "conflict", "No.");

    expect(error.envelope().details).toEqual({});
  });

  it("is an HttpException, so Nest and the filter agree about its status", () => {
    const error = new NotFoundError("tenant_not_found", "No such tenant.");

    expect(error.getResponse()).toEqual(error.envelope());
  });

  it.each([
    [NotFoundError, HttpStatus.NOT_FOUND],
    [ConflictError, HttpStatus.CONFLICT],
    [InvalidRequestError, HttpStatus.UNPROCESSABLE_ENTITY],
    [NotImplementedError, HttpStatus.NOT_IMPLEMENTED],
  ])("gives %p its own status", (Subclass, status) => {
    expect(new Subclass("code", "message").getStatus()).toBe(status);
  });
});

describe("the one 5xx a caller is allowed to read", () => {
  /**
   * `NotImplementedError` ([#224](https://github.com/NobuData/ouroboros/issues/224)) — the
   * shape a surface takes when it is specified in one ticket and implemented in another.
   *
   * Everything else above the server-error floor has its message replaced by
   * {@link INTERNAL_ERROR_MESSAGE}, because a status somebody chose and a message somebody
   * wrote for a client are different things. This one is a `DomainError`, so `answerFor`
   * returns it untouched — and that is the whole reason it is a subclass rather than a
   * `throw new HttpException(…, 501)`.
   */
  it("is above the floor, and keeps what it was constructed with", () => {
    const error = new NotImplementedError(
      "invocation_not_implemented",
      "It lands with AF.2 (issue #235).",
    );

    expect(error.getStatus()).toBeGreaterThanOrEqual(SERVER_ERROR_FLOOR);
    expect(error.envelope().message).toContain("#235");
    expect(error.envelope().message).not.toBe(INTERNAL_ERROR_MESSAGE);
  });

  it("carries a code of its own rather than internal_error", () => {
    // A `501` derived through `codeForStatus` would be `not_implemented`, which is honest
    // but says nothing about which surface. The constructor's code is what a caller
    // branches on.
    expect(new NotImplementedError("invocation_not_implemented", "…").envelope().code).toBe(
      "invocation_not_implemented",
    );
  });
});

describe("the code for a status", () => {
  it.each([
    [HttpStatus.NOT_FOUND, "not_found"],
    [HttpStatus.CONFLICT, "conflict"],
    [HttpStatus.UNPROCESSABLE_ENTITY, "unprocessable_entity"],
    [HttpStatus.METHOD_NOT_ALLOWED, "method_not_allowed"],
    [HttpStatus.UNSUPPORTED_MEDIA_TYPE, "unsupported_media_type"],
    [HttpStatus.INTERNAL_SERVER_ERROR, "internal_error"],
    [HttpStatus.NOT_IMPLEMENTED, "not_implemented"],
    [HttpStatus.SERVICE_UNAVAILABLE, "unavailable"],
  ])("names %s", (status, code) => {
    expect(codeForStatus(status)).toBe(code);
  });

  it("still names a status nobody wrote down", () => {
    // The point of deriving rather than looking up with a default: a client's
    // `switch (error.code)` should never meet `undefined`, including for a status this
    // service has not answered with before.
    expect(codeForStatus(418)).toBe("bad_request");
    expect(codeForStatus(507)).toBe("internal_error");
  });

  it("splits the two classes at the server-error floor", () => {
    expect(codeForStatus(SERVER_ERROR_FLOOR - 1)).toBe("bad_request");
    expect(codeForStatus(SERVER_ERROR_FLOOR)).toBe("internal_error");
  });
});

describe("the internal error message", () => {
  it("names nothing about the service", () => {
    // The rule `src/modules/health/` applies to a `down` message, applied here: this text
    // reaches whoever asked, and a driver's own message carries the host, the port and the
    // role it could not reach with.
    expect(INTERNAL_ERROR_MESSAGE).not.toMatch(/postgres|select|localhost|\d{4}/i);
    expect(INTERNAL_ERROR_MESSAGE).toContain("logged");
  });
});
