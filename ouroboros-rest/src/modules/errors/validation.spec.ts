import { HttpStatus, type ArgumentMetadata } from "@nestjs/common";
import { Type } from "class-transformer";
import { IsInt, type ValidationError } from "class-validator";

import type { InvalidRequestError } from "./error.envelope";
import {
  VALIDATION_FAILED,
  VALIDATION_MESSAGE,
  fieldMessages,
  validationFailed,
  validationPipe,
} from "./validation";

/**
 * The `422`, and the `details` that make it useful.
 *
 * A validation failure is the error a client causes most often, and the only one whose value
 * is in the detail rather than in the code: `validation_failed` says nothing a form can
 * render, and `{"slug": ["must be lower-case…"]}` says everything.
 */

/**
 * A `class-validator` error, without constructing the library's own class.
 *
 * @param property - The field it is about.
 * @param constraints - The messages, keyed by the decorator that produced them.
 * @param children - Errors about the fields below it.
 * @returns The error, shaped as the library reports it.
 */
function error(
  property: string,
  constraints?: Record<string, string>,
  children?: ValidationError[],
): ValidationError {
  return { property, constraints, children };
}

describe("the messages about one request", () => {
  it("keys the messages by the field they are about", () => {
    const fields = fieldMessages([
      error("slug", { matches: "slug must be lower-case", isLength: "slug is too short" }),
      error("displayName", { isString: "displayName must be a string" }),
    ]);

    expect(fields).toEqual({
      slug: ["slug must be lower-case", "slug is too short"],
      displayName: ["displayName must be a string"],
    });
  });

  it("addresses a nested field the way a reader would write it", () => {
    // Dotted paths rather than a tree: a client should be able to point at the input that
    // produced each message without walking one.
    const fields = fieldMessages([
      error("domains", undefined, [
        error("0", undefined, [error("domain", { matches: "domain must be lower-case" })]),
      ]),
    ]);

    expect(fields).toEqual({ "domains.0.domain": ["domain must be lower-case"] });
  });

  it("says nothing about a field whose only problem is in its children", () => {
    const fields = fieldMessages([
      error("window", undefined, [error("limit", { max: "too big" })]),
    ]);

    expect(fields).toEqual({ "window.limit": ["too big"] });
    expect(fields).not.toHaveProperty("window");
  });

  it("reports a field that is both wrong itself and wrong below", () => {
    const fields = fieldMessages([
      error("window", { isObject: "window must be an object" }, [
        error("limit", { max: "too big" }),
      ]),
    ]);

    expect(fields).toEqual({
      window: ["window must be an object"],
      "window.limit": ["too big"],
    });
  });

  it("is empty for no complaints at all", () => {
    expect(fieldMessages([])).toEqual({});
  });
});

describe("the error a failure becomes", () => {
  it("is a 422 carrying the fields", () => {
    const failure = validationFailed([error("slug", { matches: "slug must be lower-case" })]);

    expect(failure.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(failure.envelope()).toEqual({
      code: VALIDATION_FAILED,
      message: VALIDATION_MESSAGE,
      details: { slug: ["slug must be lower-case"] },
    });
  });

  it("is 422 rather than 400, as the issue's diagram names", () => {
    // `400` says "I cannot parse this"; `422` says "I understood it and the content is not
    // acceptable". Conflating them costs a client the ability to tell the two apart.
    expect(validationFailed([]).getStatus()).not.toBe(HttpStatus.BAD_REQUEST);
  });
});

/** A DTO of this file's own, so the pipe is exercised without importing a feature's. */
class Example {
  @IsInt()
  @Type(() => Number)
  count!: number;
}

/**
 * What the pipe refused a value with.
 *
 * @param value - The argument to transform.
 * @param metadata - What Nest would tell the pipe about it.
 * @returns The error it threw.
 * @throws {Error} If the pipe accepted the value, which is what every caller here is
 *   asserting it does not.
 */
async function refusalOf(value: unknown, metadata: ArgumentMetadata): Promise<InvalidRequestError> {
  try {
    await validationPipe().transform(value, metadata);
  } catch (failure) {
    return failure as InvalidRequestError;
  }

  throw new Error("the pipe accepted a value this test expected it to refuse");
}

describe("the pipe every route is validated by", () => {
  /** What Nest tells the pipe about the argument it is transforming. */
  const asBody: ArgumentMetadata = { type: "body", metatype: Example };

  it("transforms, so a query string's number arrives as one", async () => {
    // Without this every numeric query parameter would fail the validation that is about the
    // number it names, because a query string only ever carries strings.
    await expect(validationPipe().transform({ count: "10" }, asBody)).resolves.toEqual({
      count: 10,
    });
  });

  it("refuses a property the DTO does not declare", async () => {
    // Whitelisting alone would drop it silently. Refusing is the difference between closing
    // mass assignment and hiding it: a client setting a field nobody meant to expose is told
    // so rather than left believing it worked.
    const failure = await refusalOf({ count: 1, isAdmin: true }, asBody);

    expect(failure.envelope().details).toHaveProperty("isAdmin");
  });

  it("answers a bad value with this file's envelope", async () => {
    const failure = await refusalOf({ count: "not a number" }, asBody);

    expect(failure.envelope()).toMatchObject({ code: VALIDATION_FAILED });
  });
});
