import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { ListQueueQuery } from "./queue.dto";

/**
 * The request shape, validated the way the pipe validates it — through
 * `class-transformer`, so the strings a query string actually carries are what the
 * decorators judge.
 */

/** Validate a query the way the pipe would, returning the failing property names. */
async function queryViolations(query: Record<string, unknown>): Promise<string[]> {
  const failures = await validate(plainToInstance(ListQueueQuery, query));
  return failures.map((failure) => failure.property);
}

describe("the listing query", () => {
  it("admits an empty query, because everything about it is optional", async () => {
    // Unlike the runs listing there is no family to require: the queue has exactly one
    // order, so `GET /api/v1/queue` with nothing else is a complete question.
    expect(await queryViolations({})).toEqual([]);
  });

  it("admits a repository filter that is a uuid, and refuses one that is not", async () => {
    expect(await queryViolations({ repo: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10" })).toEqual([]);
    // The name is not the id: two enabled GitHub orgs may both own a `tools`.
    expect(await queryViolations({ repo: "helios-firmware" })).toEqual(["repo"]);
  });

  it("keeps the #31 window rules by extension, not by copy", async () => {
    // One definition of limit/offset: the inherited decorators are the convention's own.
    expect(await queryViolations({ limit: "10", offset: "30" })).toEqual([]);
    expect(await queryViolations({ limit: "0" })).toEqual(["limit"]);
    expect(await queryViolations({ limit: "101" })).toEqual(["limit"]);
    expect(await queryViolations({ offset: "-1" })).toEqual(["offset"]);
  });
});
