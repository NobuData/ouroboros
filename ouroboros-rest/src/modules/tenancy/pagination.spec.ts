import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";

import {
  DEFAULT_LIMIT,
  DEFAULT_OFFSET,
  MAX_LIMIT,
  PageQuery,
  pageOf,
  windowOf,
} from "./pagination";

/**
 * The pagination convention, and the two things that make it one.
 *
 * A convention is only worth the name if every endpoint gets the same defaults and the same
 * ceiling, so this is where both are pinned — including the ceiling, which is the only thing
 * standing between `?limit=1000000` and this service serialising a table.
 */

/**
 * Run a query string through the pipe's transform and validation, as a request does.
 *
 * @param query - What a client sent. Every value a string, because a query string has no
 *   other kind.
 * @returns The messages the DTO produced, keyed by field. Empty when it validated.
 */
async function complaints(query: Record<string, string>): Promise<Record<string, string[]>> {
  const errors = await validate(plainToInstance(PageQuery, query));

  return Object.fromEntries(
    errors.map((error) => [error.property, Object.values(error.constraints ?? {})]),
  );
}

describe("the window a request asks for", () => {
  it("defaults to the first page", () => {
    expect(windowOf({})).toEqual({ limit: DEFAULT_LIMIT, offset: DEFAULT_OFFSET });
  });

  it("defaults when there is no query at all", () => {
    expect(windowOf()).toEqual({ limit: DEFAULT_LIMIT, offset: DEFAULT_OFFSET });
  });

  it("keeps each field the request did name", () => {
    expect(windowOf({ limit: 5 })).toEqual({ limit: 5, offset: DEFAULT_OFFSET });
    expect(windowOf({ offset: 50 })).toEqual({ limit: DEFAULT_LIMIT, offset: 50 });
    expect(windowOf({ limit: 5, offset: 50 })).toEqual({ limit: 5, offset: 50 });
  });
});

describe("the query string of a list endpoint", () => {
  it("accepts the numbers a query string carries as strings", async () => {
    // `@Type(() => Number)` is what makes this true, and without it every numeric query
    // parameter would fail the validation that is about the number it names.
    const query = plainToInstance(PageQuery, { limit: "10", offset: "20" });

    expect(await validate(query)).toEqual([]);
    expect(query).toEqual({ limit: 10, offset: 20 });
  });

  it("accepts a request that names neither", async () => {
    expect(await complaints({})).toEqual({});
  });

  it("refuses a limit above the ceiling", async () => {
    // The ceiling is not a suggestion: the request that asks for a million rows is
    // indistinguishable from a mistake in a loop.
    expect(await complaints({ limit: String(MAX_LIMIT + 1) })).toHaveProperty("limit");
    expect(await complaints({ limit: String(MAX_LIMIT) })).toEqual({});
  });

  it.each([
    ["a limit of zero", { limit: "0" }, "limit"],
    ["a negative limit", { limit: "-1" }, "limit"],
    ["a fractional limit", { limit: "1.5" }, "limit"],
    ["a negative offset", { offset: "-1" }, "offset"],
    ["a limit that is not a number", { limit: "lots" }, "limit"],
  ])("refuses %s", async (_case, query, field) => {
    expect(await complaints(query)).toHaveProperty(field);
  });
});

describe("a page", () => {
  it("echoes back the window that was applied", () => {
    // Not the window that was *asked for*: a client that sent neither still has to be able
    // to compute the next offset, and it cannot do that without knowing what it got.
    const page = pageOf(["a", "b"], 7, { limit: 2, offset: 4 });

    expect(page).toEqual({ items: ["a", "b"], total: 7, limit: 2, offset: 4 });
  });

  it("reports a total that ignores the window", () => {
    // The field that makes a page count renderable, and the reason `count(*)` is worth the
    // second statement.
    expect(pageOf([], 42, { limit: 25, offset: 100 }).total).toBe(42);
  });
});
