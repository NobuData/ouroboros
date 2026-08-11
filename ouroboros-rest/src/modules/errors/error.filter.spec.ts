import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  type ArgumentsHost,
} from "@nestjs/common";

import { ConflictError, INTERNAL_ERROR_MESSAGE } from "./error.envelope";
import { ErrorEnvelopeFilter, answerFor, type FilteredResponse } from "./error.filter";

/**
 * The catch-all, and the one thing it deliberately does not catch.
 *
 * Two halves. {@link answerFor} is the mapping and is tested as a table, because every
 * decision about what a client is told lives there. The filter itself is tested for the
 * plumbing that cannot be pure: that it writes to the adapter, that it logs a `500` and does
 * not log a `404`, and that a probe's body reaches its reader untouched.
 */

/** A response that records what was written to it, in place of the adapter's. */
function recordingResponse(): FilteredResponse & { status_?: number; body_?: unknown } {
  const response: FilteredResponse & { status_?: number; body_?: unknown } = {
    status(code: number) {
      response.status_ = code;
      return response;
    },
    json(body: unknown) {
      response.body_ = body;
      return response;
    },
  };

  return response;
}

/**
 * An `ArgumentsHost` carrying one request and one response.
 *
 * @param url - What the adapter saw, query string and all.
 * @param response - Where the answer is written.
 * @returns Enough of a host for the filter, typed so no `any` is needed.
 */
function host(url: string, response: FilteredResponse): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ url }),
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;
}

describe("the answer for a failure", () => {
  it("takes a domain error's own envelope, unchanged", () => {
    const error = new ConflictError("domain_taken", "That domain belongs to another tenant.", {
      domain: "acme.example",
    });

    expect(answerFor(error)).toEqual({
      status: HttpStatus.CONFLICT,
      body: {
        code: "domain_taken",
        message: "That domain belongs to another tenant.",
        details: { domain: "acme.example" },
      },
    });
  });

  it("gives the framework's own 404 a code", () => {
    // Nest's answer for a path no controller claims. Without this it would be the one class
    // of error with no `code` — the hole a client's `switch` falls through.
    const answer = answerFor(new NotFoundException("Cannot GET /api/v1/nope"));

    expect(answer).toEqual({
      status: HttpStatus.NOT_FOUND,
      body: { code: "not_found", message: "Cannot GET /api/v1/nope", details: {} },
    });
  });

  it("flattens the several complaints a pipe can carry into one sentence", () => {
    // Nest's default validation shape. The structured form belongs in `details`, which is
    // what `validation.ts` produces; this is the fallback for a pipe that did not use it.
    const answer = answerFor(new BadRequestException(["a is wrong", "b is wrong"]));

    expect(answer.body.message).toBe("a is wrong; b is wrong");
  });

  it("keeps an exception's message when the exception carries a plain string", () => {
    expect(answerFor(new HttpException("nope", HttpStatus.FORBIDDEN)).body).toEqual({
      code: "forbidden",
      message: "nope",
      details: {},
    });
  });

  it("refuses to publish a 5xx exception's own message", () => {
    // The status came from somewhere deliberate; the text did not, and a 5xx's text is where
    // a host, a role or a query name ends up.
    const answer = answerFor(new ServiceUnavailableException("cannot reach 10.0.0.4:5432"));

    expect(answer.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect(answer.body.message).toBe(INTERNAL_ERROR_MESSAGE);
  });

  it.each([
    ["an ordinary error", new Error("connect ECONNREFUSED 127.0.0.1:5432")],
    ["a rejection that is not an error", "something threw a string"],
    ["nothing at all", undefined],
  ])("answers 500 and says nothing about %s", (_case, thrown) => {
    expect(answerFor(thrown)).toEqual({
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: { code: "internal_error", message: INTERNAL_ERROR_MESSAGE, details: {} },
    });
  });
});

describe("the filter", () => {
  let logged: jest.SpyInstance;

  beforeEach(() => {
    logged = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  it("writes the envelope to the adapter", () => {
    const response = recordingResponse();

    new ErrorEnvelopeFilter().catch(
      new ConflictError("slug_taken", "Taken."),
      host("/api/v1/tenants", response),
    );

    expect(response.status_).toBe(HttpStatus.CONFLICT);
    expect(response.body_).toEqual({ code: "slug_taken", message: "Taken.", details: {} });
  });

  it("diagnoses a 500 in the log, where only an operator reads it", () => {
    const response = recordingResponse();
    const cause = new Error("connect ECONNREFUSED 127.0.0.1:5432");

    new ErrorEnvelopeFilter().catch(cause, host("/api/v1/tenants", response));

    expect(logged).toHaveBeenCalledWith(expect.stringContaining("ECONNREFUSED"), cause.stack);
    // …and the client is told none of it.
    expect(response.body_).toEqual({
      code: "internal_error",
      message: INTERNAL_ERROR_MESSAGE,
      details: {},
    });
  });

  it("says nothing about a 4xx", () => {
    // A caller's mistake is not an incident. Logging every one of them is how a log stops
    // being read.
    new ErrorEnvelopeFilter().catch(
      new ConflictError("slug_taken", "Taken."),
      host("/api/v1/tenants", recordingResponse()),
    );

    expect(logged).not.toHaveBeenCalled();
  });

  it("leaves an exempt path's body exactly as it was thrown", () => {
    // `/health/ready` answers 503 with Terminus's report, which `openapi.yaml` describes and
    // a compose healthcheck reads. Rewriting it into an envelope would break the one body in
    // this service written for a reader that is not a browser.
    const report = { status: "error", info: {}, error: { database: { status: "down" } } };
    const response = recordingResponse();

    new ErrorEnvelopeFilter(["/health/ready"]).catch(
      new ServiceUnavailableException(report),
      host("/health/ready", response),
    );

    expect(response.status_).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect(response.body_).toEqual(report);
  });

  it("recognises an exempt path that was called with a query string", () => {
    const response = recordingResponse();

    new ErrorEnvelopeFilter(["/health/live"]).catch(
      new ServiceUnavailableException({ status: "shutting_down" }),
      host("/health/live?from=compose", response),
    );

    expect(response.body_).toEqual({ status: "shutting_down" });
  });

  it("still envelopes a crash on an exempt path", () => {
    // The exemption is for the shapes the probes *document*. A `TypeError` is not one of
    // them, and answering it with a half-built health report would be worse than a 500.
    const response = recordingResponse();

    new ErrorEnvelopeFilter(["/health/ready"]).catch(
      new TypeError("undefined is not a function"),
      host("/health/ready", response),
    );

    expect(response.status_).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(response.body_).toEqual({
      code: "internal_error",
      message: INTERNAL_ERROR_MESSAGE,
      details: {},
    });
  });

  it("envelopes a failure on a path that is not exempt", () => {
    const response = recordingResponse();

    new ErrorEnvelopeFilter(["/health/ready"]).catch(
      new NotFoundException("Cannot GET /api/v1/nope"),
      host("/api/v1/nope", response),
    );

    expect(response.body_).toEqual({
      code: "not_found",
      message: "Cannot GET /api/v1/nope",
      details: {},
    });
  });
});
