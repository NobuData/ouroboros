import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { PatchAutoMergeDto } from "./settings.dto";

/**
 * The body's grammar: a boolean, or absence, and nothing in between. The column behind it
 * is `boolean not null`, so what is held here is not a CHECK restated but the coercion
 * refused — a `"true"`, a `1` or a `null` is a `422` naming the field, never a truthy
 * accident that flips a workspace's merge posture.
 */

/** Validate a body as the pipe would. */
async function refusalsOf(body: unknown): Promise<string[]> {
  const errors = await validate(plainToInstance(PatchAutoMergeDto, body));

  return errors.map((error) => error.property);
}

describe("the auto-merge patch body", () => {
  it("accepts each position of the switch", async () => {
    await expect(refusalsOf({ enabled: true })).resolves.toEqual([]);
    await expect(refusalsOf({ enabled: false })).resolves.toEqual([]);
  });

  it("accepts absence — PATCH means send what changed", async () => {
    await expect(refusalsOf({})).resolves.toEqual([]);
  });

  it.each([["true"], [1], [0], [null], ["yes"]])("refuses %p, naming the field", async (value) => {
    await expect(refusalsOf({ enabled: value })).resolves.toEqual(["enabled"]);
  });
});
