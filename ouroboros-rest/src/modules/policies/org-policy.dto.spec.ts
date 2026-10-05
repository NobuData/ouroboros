import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { PatchDryRunPolicyDto, PathPreviewDto, PolicyVersionsQuery } from "./org-policy.dto";

/**
 * The flip's body: a real boolean, required. A coercion accepted here would be a workspace
 * starting to merge without a person on the strength of a `"false"` string.
 */

async function refusalsOf(body: unknown): Promise<string[]> {
  const errors = await validate(plainToInstance(PatchDryRunPolicyDto, body));

  return errors.map((error) => error.property);
}

describe("the dry-run flip body", () => {
  it("accepts each position", async () => {
    await expect(refusalsOf({ dryRun: true })).resolves.toEqual([]);
    await expect(refusalsOf({ dryRun: false })).resolves.toEqual([]);
  });

  it("refuses absence — a flip must say which way", async () => {
    await expect(refusalsOf({})).resolves.toEqual(["dryRun"]);
  });

  it.each([["false"], [0], [1], [null], ["off"]])("refuses %p, naming the field", async (value) => {
    await expect(refusalsOf({ dryRun: value })).resolves.toEqual(["dryRun"]);
  });
});

/**
 * The history's query string and the match preview's body (BS.4, #494).
 *
 * @param dto - The class to validate as.
 * @param body - What arrived.
 * @returns The properties refused.
 */
async function refused(dto: new () => object, body: unknown): Promise<string[]> {
  const errors = await validate(plainToInstance(dto, body));

  return errors.map((error) => error.property);
}

describe("the policy history query", () => {
  it("accepts nothing, and a page read from the query string", async () => {
    await expect(refused(PolicyVersionsQuery, {})).resolves.toEqual([]);
    await expect(refused(PolicyVersionsQuery, { limit: "100", before: "7" })).resolves.toEqual([]);
    expect(plainToInstance(PolicyVersionsQuery, { limit: "5", before: "7" })).toEqual({
      limit: 5,
      before: 7,
    });
  });

  it.each([[{ limit: "0" }], [{ limit: "101" }], [{ limit: "2.5" }], [{ limit: "many" }]])(
    "refuses the page size %p",
    async (query) => {
      await expect(refused(PolicyVersionsQuery, query)).resolves.toEqual(["limit"]);
    },
  );

  it.each([[{ before: "0" }], [{ before: "v7" }]])("refuses the cursor %p", async (query) => {
    await expect(refused(PolicyVersionsQuery, query)).resolves.toEqual(["before"]);
  });
});

describe("the path preview body", () => {
  it("accepts one to sixty-four distinct strings", async () => {
    await expect(refused(PathPreviewDto, { globs: ["boot/**"] })).resolves.toEqual([]);
    await expect(
      refused(PathPreviewDto, {
        globs: Array.from({ length: 64 }, (_, at) => `d${String(at)}/**`),
      }),
    ).resolves.toEqual([]);
  });

  it.each([
    [{}],
    [{ globs: [] }],
    [{ globs: "boot/**" }],
    [{ globs: ["boot/**", "boot/**"] }],
    [{ globs: ["boot/**", 7] }],
    [{ globs: Array.from({ length: 65 }, (_, at) => `d${String(at)}/**`) }],
  ])("refuses %p, naming the field", async (body) => {
    await expect(refused(PathPreviewDto, body)).resolves.toEqual(["globs"]);
  });
});
