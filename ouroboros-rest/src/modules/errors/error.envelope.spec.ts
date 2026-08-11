import { HttpStatus } from "@nestjs/common";

import {
  ConflictError,
  DomainError,
  INTERNAL_ERROR_MESSAGE,
  InvalidRequestError,
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
  ])("gives %p its own status", (Subclass, status) => {
    expect(new Subclass("code", "message").getStatus()).toBe(status);
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
