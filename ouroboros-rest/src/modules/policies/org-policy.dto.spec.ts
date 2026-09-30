import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { PatchDryRunPolicyDto } from "./org-policy.dto";

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
