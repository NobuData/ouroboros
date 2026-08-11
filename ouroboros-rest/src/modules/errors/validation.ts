/**
 * How a malformed request becomes an envelope: DTO validation, and the `422` it produces.
 *
 * `class-validator` decorators on the DTOs describe what a body, a query string and a path
 * parameter may contain; Nest's `ValidationPipe` enforces them before a handler runs. What
 * this file adds is the last step — turning the library's `ValidationError[]` into
 * `{code, message, details}`, so the one failure a client causes most often answers in the
 * same shape as every other.
 *
 * The validated object is also the *only* thing a handler sees. `whitelist` strips what the
 * DTO does not declare and `forbidNonWhitelisted` refuses it outright, which is what stops
 * a client from setting a column nobody meant to expose by adding a property to a body —
 * the mass-assignment failure, closed by construction rather than by remembering to pick
 * fields off in every service.
 */

import { ValidationPipe } from "@nestjs/common";
import type { ValidationError } from "class-validator";

import { InvalidRequestError } from "./error.envelope";

/** The code every validation failure carries. Documented on every operation that can 422. */
export const VALIDATION_FAILED = "validation_failed";

/** What a human is told. The specifics are in `details`, one entry per field. */
export const VALIDATION_MESSAGE = "The request is not valid. See `details` for each field.";

/**
 * The complaints about one request, keyed by the field they are about.
 *
 * Nested objects and arrays are addressed the way a reader would write them —
 * `domains.0.domain` — so a client can point at the input that produced each message
 * without walking a tree.
 *
 * @param errors - What `class-validator` reported.
 * @param prefix - The path of the object these errors are about. Empty at the top level;
 *   supplied by the recursion for anything below it.
 * @returns Field path to the messages about it. A field whose only problem is in its
 *   children contributes no entry of its own.
 */
export function fieldMessages(
  errors: readonly ValidationError[],
  prefix = "",
): Record<string, string[]> {
  const fields: Record<string, string[]> = {};

  for (const error of errors) {
    const path = prefix === "" ? error.property : `${prefix}.${error.property}`;

    if (error.constraints !== undefined) {
      // The constraint *names* are the library's — `isUuid`, `matches` — and say nothing a
      // client can act on; the values are the messages the decorators produced, which are
      // what a form renders beside the input.
      fields[path] = Object.values(error.constraints);
    }

    if (error.children !== undefined && error.children.length > 0) {
      Object.assign(fields, fieldMessages(error.children, path));
    }
  }

  return fields;
}

/**
 * Turn a validation failure into the error the filter will publish.
 *
 * Passed to `ValidationPipe` as its `exceptionFactory`, which is what replaces Nest's own
 * `400 {statusCode, message[], error}` — a shape that is neither the envelope nor the status
 * the issue's diagram names.
 *
 * @param errors - What `class-validator` reported.
 * @returns A `422` carrying one entry per invalid field in `details`.
 */
export function validationFailed(errors: ValidationError[]): InvalidRequestError {
  return new InvalidRequestError(VALIDATION_FAILED, VALIDATION_MESSAGE, fieldMessages(errors));
}

/**
 * The pipe every route is validated by.
 *
 * @returns A `ValidationPipe` configured with the four decisions above: transform, so a
 *   query string's `limit=10` reaches a handler as the number its DTO declares; whitelist
 *   and forbid, so a property the DTO does not declare is refused rather than silently
 *   dropped; and this file's factory, so the answer is an envelope.
 */
export function validationPipe(): ValidationPipe {
  return new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    exceptionFactory: validationFailed,
  });
}
