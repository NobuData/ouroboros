import { validate } from "class-validator";

import { FONT_SCALES } from "../db/schema";
import { PatchPreferencesDto } from "./preferences.dto";

/**
 * The DTO restates V007's CHECK, and this is where the two are read side by side: every
 * step the constraint admits validates, everything else is a `422`-shaped failure naming
 * the field. `constraints.sql` holds the database to the same five from below.
 */

/** Validate a body the way the pipe would. */
async function violations(body: Partial<PatchPreferencesDto>): Promise<string[]> {
  const dto = Object.assign(new PatchPreferencesDto(), body);
  const failures = await validate(dto);

  return failures.map((failure) => failure.property);
}

describe("the preferences patch body", () => {
  it.each([...FONT_SCALES])("admits the step %s", async (step) => {
    expect(await violations({ fontScale: step })).toEqual([]);
  });

  it("admits an empty patch, which reads back the current state", async () => {
    expect(await violations({})).toEqual([]);
  });

  it.each([
    // The near-misses that make text-with-CHECK the right storage: respellings of a named
    // step are different strings, and must be refused rather than coerced.
    ["a respelled step", "100.0"],
    ["a step § 4 does not name", "90"],
    ["a number rather than a label", 125],
    ["arbitrary text", "large"],
    ["the empty string", ""],
  ])("refuses %s", async (_name, value) => {
    expect(await violations({ fontScale: value as never })).toEqual(["fontScale"]);
  });
});
