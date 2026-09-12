/**
 * The filter that makes the envelope true of *every* answer, not only the deliberate ones.
 *
 * `DomainError` already carries its envelope, so a handler that throws one needs nothing
 * from this file. What needs it is everything else that can end a request: Nest's own `404`
 * for a path no controller claims, a `413` from the body parser, a `TypeError` from a
 * library, a connection the database refused. Without a catch-all those answer in three
 * different shapes, and a client's error handling has to know which layer failed.
 *
 * Registered in `src/application.ts` beside the global prefix and the versioning, because
 * it is the same kind of decision: one that is made once, for every route, rather than per
 * controller.
 */

import {
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import { Catch } from "@nestjs/common";

import {
  DomainError,
  INTERNAL_ERROR_MESSAGE,
  SERVER_ERROR_FLOOR,
  codeForStatus,
  type ErrorEnvelope,
} from "./error.envelope";

/**
 * The part of a platform request this filter reads.
 *
 * Structural rather than `express.Request`, matching `src/application.ts`: this module has
 * no opinion about the HTTP adapter, and naming the two fields it actually touches is both
 * the documentation and the coupling.
 */
export interface FilteredRequest {
  /** The path, as the adapter saw it — with the query string still attached. */
  url?: string;
  /** What the adapter saw before any router rewrote it, when it offers one. */
  originalUrl?: string;
}

/** The part of a platform response this filter writes. */
export interface FilteredResponse {
  status(code: number): FilteredResponse;
  json(body: unknown): unknown;
}

/** An answer: the status line and the body that goes with it. */
export interface FilteredAnswer {
  status: number;
  body: ErrorEnvelope;
}

/**
 * Turn any thrown thing into a status and an envelope.
 *
 * Exported and pure so the mapping is tested as a table rather than through a mocked
 * `ArgumentsHost` — the filter below is then only the plumbing between it and the adapter.
 *
 * Three cases, in order of how much is known:
 *
 *   * A {@link DomainError} already *is* the answer. Nothing is derived.
 *   * Another `HttpException` knows its status and, for a 4xx, has a message written for a
 *     client — Nest's `Cannot GET /nope` among them. The code is derived from the status.
 *   * A body-parser failure is **not** an `HttpException` and would otherwise fall to the
 *     case below — see {@link bodyParserAnswer}, which is what makes a body this API will
 *     not read a `413` or a `400` rather than an `internal_error`.
 *   * Anything else is a `500` whose message is {@link INTERNAL_ERROR_MESSAGE} and whose
 *     own text never leaves the process. So is a 5xx `HttpException`: the status came from
 *     somewhere deliberate, the message did not.
 *
 * @param exception - Whatever was thrown. Typed `unknown` because that is what a `catch`
 *   binding is, and because the interesting cases here are the ones that are not `Error`.
 * @returns The status to answer with and the envelope to answer with.
 */
export function answerFor(exception: unknown): FilteredAnswer {
  if (exception instanceof DomainError) {
    return { status: exception.getStatus(), body: exception.envelope() };
  }

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const message = status >= SERVER_ERROR_FLOOR ? INTERNAL_ERROR_MESSAGE : messageOf(exception);

    return { status, body: { code: codeForStatus(status), message, details: {} } };
  }

  const unread = bodyParserAnswer(exception);

  if (unread !== undefined) {
    return unread;
  }

  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    body: {
      code: codeForStatus(HttpStatus.INTERNAL_SERVER_ERROR),
      message: INTERNAL_ERROR_MESSAGE,
      details: {},
    },
  };
}

/**
 * What a body-parser refusal means, keyed by the `type` `body-parser` puts on it.
 *
 * **The parser runs before Nest's pipeline, so its failures are not `HttpException`s** —
 * they are `http-errors` objects, and without this table every one of them is the `500`
 * below. That is the wrong answer twice over: the caller *can* act on each of these, and
 * `error.envelope.ts` already publishes a code for them
 * (`GENERIC_CODES` carries `payload_too_large`), which until now nothing could reach.
 *
 * **The parser's own message is never forwarded.** `body-parser` writes *request entity too
 * large*, and it writes the configured limit into the error object beside it; the sentences
 * here are written for a person, name no number, and are the same whatever the limit is
 * configured to.
 *
 * The set is enumerated rather than derived from the error's status, so a type this service
 * has never seen falls through to the `500` and is logged, instead of being dressed up as a
 * `4xx` on the strength of a field some other library also happens to have.
 */
const BODY_PARSER_FAILURES: Readonly<Record<string, { status: number; message: string }>> =
  Object.freeze({
    "entity.too.large": {
      status: HttpStatus.PAYLOAD_TOO_LARGE,
      message: "This request body is larger than this API accepts.",
    },
    "entity.parse.failed": {
      status: HttpStatus.BAD_REQUEST,
      message: "This request body is not valid JSON.",
    },
    "entity.verify.failed": {
      status: HttpStatus.BAD_REQUEST,
      message: "This request body could not be read.",
    },
    "request.aborted": {
      status: HttpStatus.BAD_REQUEST,
      message: "This request ended before its body arrived.",
    },
    "charset.unsupported": {
      status: HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      message: "This request body is in a character set this API does not read.",
    },
    "encoding.unsupported": {
      status: HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      message: "This request body is in a content encoding this API does not read.",
    },
  });

/**
 * The answer for a request whose body the parser refused, if that is what this was.
 *
 * Exported for the same reason {@link answerFor} is: the mapping is a table, and a table is
 * tested as one.
 *
 * @param exception - Whatever was thrown.
 * @returns The status and envelope, or `undefined` when this is not a body-parser failure —
 *   which leaves it to the `500`, where a failure nobody classified belongs.
 */
export function bodyParserAnswer(exception: unknown): FilteredAnswer | undefined {
  if (typeof exception !== "object" || exception === null) {
    return undefined;
  }

  const type = (exception as { type?: unknown }).type;

  if (typeof type !== "string") {
    return undefined;
  }

  const failure = BODY_PARSER_FAILURES[type];

  if (failure === undefined) {
    return undefined;
  }

  return {
    status: failure.status,
    body: { code: codeForStatus(failure.status), message: failure.message, details: {} },
  };
}

/**
 * The human-readable half of an `HttpException`.
 *
 * Nest puts a string there when the exception was constructed with one and an object of
 * `{statusCode, message, error}` when it was constructed with none — and `message` in that
 * object is an array whenever a pipe collected several complaints. All three are flattened
 * to one sentence, because the envelope's `message` is a string and the structured form of
 * a validation failure belongs in `details` (see `validation.ts`).
 *
 * @param exception - The exception to read.
 * @returns Its message, or the framework's own class name when it carries none.
 */
function messageOf(exception: HttpException): string {
  const response = exception.getResponse();

  if (typeof response === "string") {
    return response;
  }

  const message = (response as { message?: unknown }).message;

  if (typeof message === "string") {
    return message;
  }

  if (Array.isArray(message)) {
    return message.map(String).join("; ");
  }

  return exception.message;
}

/**
 * Answer every failure with the envelope — except on the paths that answer to infrastructure.
 *
 * @see answerFor for the mapping, which is where the decisions are.
 */
@Catch()
export class ErrorEnvelopeFilter implements ExceptionFilter {
  /** Where a `500` is diagnosed. The client is told nothing; this is told everything. */
  private readonly logger = new Logger(ErrorEnvelopeFilter.name);

  /**
   * @param exemptPaths - Paths whose failures are left in whatever shape they were thrown.
   *   `src/application.ts` passes `PROBE_PATHS`, the same list it excludes from the global
   *   prefix: `/health/ready` answers `503` with `@nestjs/terminus`'s report, that report is
   *   what a compose healthcheck and `openapi.yaml` both describe, and rewriting it into an
   *   envelope would break the one body in this service written for a reader that is not a
   *   browser. Enumerated rather than sniffed from the exception, so the exemption is a list
   *   two files share and not a shape that could be matched by accident.
   */
  constructor(private readonly exemptPaths: readonly string[] = []) {}

  /**
   * Answer a failed request.
   *
   * @param exception - Whatever the handler, a pipe, a guard or the router threw.
   * @param host - The execution context, for the adapter's request and response.
   */
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<FilteredResponse>();

    if (exception instanceof HttpException && this.isExempt(http.getRequest<FilteredRequest>())) {
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }

    const answer = answerFor(exception);

    if (answer.status >= SERVER_ERROR_FLOOR) {
      // The whole reason the client's message is a constant: this is where the driver's
      // text, the failing query and the stack are allowed to be, because only an operator
      // reads it. `Logger.error` takes the stack as its second argument.
      const cause = exception instanceof Error ? exception : new Error(String(exception));
      this.logger.error(`${answer.body.code}: ${cause.message}`, cause.stack);
    }

    response.status(answer.status).json(answer.body);
  }

  /**
   * Whether this request's failures are left alone.
   *
   * @param request - The request being answered.
   * @returns `true` when its path is one of {@link exemptPaths}. The query string is cut
   *   first: `/health/ready?from=compose` is the readiness probe, and a reader that is a
   *   healthcheck line has every right to put something on the end of the URL.
   */
  private isExempt(request: FilteredRequest): boolean {
    const url = request.originalUrl ?? request.url ?? "";
    const query = url.indexOf("?");

    return this.exemptPaths.includes(query === -1 ? url : url.slice(0, query));
  }
}
