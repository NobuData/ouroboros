import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { RUN_EVENTS_PAGE_MAX } from "./console.policy";
import {
  ListRunsQuery,
  MAX_EVENT_SEQ,
  RUN_STATUS_FAMILIES,
  RunEventsQuery,
  RunParams,
} from "./runs.dto";

/**
 * The request shapes, validated the way the pipe validates them — through
 * `class-transformer`, so the strings a query string actually carries are what the
 * decorators judge.
 */

/** Validate a query the way the pipe would, returning the failing property names. */
async function queryViolations(query: Record<string, unknown>): Promise<string[]> {
  const failures = await validate(plainToInstance(ListRunsQuery, query));
  return failures.map((failure) => failure.property);
}

describe("the listing query", () => {
  it.each([...RUN_STATUS_FAMILIES])("admits the family %s", async (status) => {
    expect(await queryViolations({ status })).toEqual([]);
  });

  it("requires the family, because the two have different orders", async () => {
    // A mixed listing would need an ordering that interleaves "where is it in the
    // pipeline" with "when did it stop", and no screen asks that question.
    expect(await queryViolations({})).toEqual(["status"]);
  });

  it.each([
    ["a single status rather than a family", "coding"],
    ["a family nobody defined", "everything"],
    ["the empty string", ""],
  ])("refuses %s", async (_name, status) => {
    expect(await queryViolations({ status })).toEqual(["status"]);
  });

  it("admits a repository filter that is a uuid, and refuses one that is not", async () => {
    expect(
      await queryViolations({ status: "active", repo: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10" }),
    ).toEqual([]);
    // The name is not the id: two enabled GitHub orgs may both own a `tools`.
    expect(await queryViolations({ status: "active", repo: "helios-firmware" })).toEqual(["repo"]);
  });

  it("keeps the #31 window rules by extension, not by copy", async () => {
    // One definition of limit/offset: the inherited decorators are the convention's own.
    expect(await queryViolations({ status: "active", limit: "10", offset: "30" })).toEqual([]);
    expect(await queryViolations({ status: "active", limit: "0" })).toEqual(["limit"]);
    expect(await queryViolations({ status: "active", limit: "101" })).toEqual(["limit"]);
    expect(await queryViolations({ status: "active", offset: "-1" })).toEqual(["offset"]);
  });
});

describe("the detail's path", () => {
  it("admits a uuid and refuses anything else, naming the field", async () => {
    const good = await validate(
      plainToInstance(RunParams, { id: "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94" }),
    );
    expect(good).toEqual([]);

    // Malformed is the caller's mistake (422 from the pipe); well-formed-but-absent is the
    // repository's 404. The distinction keeps a probe from reading validation as existence.
    const bad = await validate(plainToInstance(RunParams, { id: "not-a-uuid" }));
    expect(bad.map((failure) => failure.property)).toEqual(["id"]);
  });
});

describe("the transcript tail's query", () => {
  /** Validate the tail's query the way the pipe would, returning the failing property names. */
  async function tailViolations(query: Record<string, unknown>): Promise<string[]> {
    const failures = await validate(plainToInstance(RunEventsQuery, query));
    return failures.map((failure) => failure.property);
  }

  it("admits no query at all — the start of the transcript, at the default page size", async () => {
    expect(await tailViolations({})).toEqual([]);
  });

  it("admits a cursor and a page size, as the strings a query string carries", async () => {
    const query = plainToInstance(RunEventsQuery, { after: "7", limit: "50" });

    expect(await validate(query)).toEqual([]);
    // Transformed, so the service compares numbers rather than strings: "10" > "9" is false.
    expect(query.after).toBe(7);
    expect(query.limit).toBe(50);
  });

  it("admits the cursor at zero and at the largest seq PostgreSQL's integer can hold", async () => {
    expect(await tailViolations({ after: "0" })).toEqual([]);
    expect(await tailViolations({ after: String(MAX_EVENT_SEQ) })).toEqual([]);
  });

  it.each([
    ["a negative cursor", { after: "-1" }, "after"],
    ["a fractional cursor", { after: "1.5" }, "after"],
    ["a cursor that is not a number", { after: "abc" }, "after"],
    ["a cursor past integer range", { after: String(MAX_EVENT_SEQ + 1) }, "after"],
    ["a page of nothing", { limit: "0" }, "limit"],
    ["a page larger than the cap", { limit: String(RUN_EVENTS_PAGE_MAX + 1) }, "limit"],
  ])("refuses %s, naming the field", async (_name, query, field) => {
    expect(await tailViolations(query)).toEqual([field]);
  });
});
