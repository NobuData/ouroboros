import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { PatchRetentionDto } from "./retention.dto";

/** The body's shape (#482). The bounds are the service's; the DTO checks types only. */

/** The properties a body is refused on. */
async function refused(body: object): Promise<string[]> {
  const errors = await validate(plainToInstance(PatchRetentionDto, body));
  return errors.map((error) => error.property);
}

describe("the retention patch body", () => {
  it("accepts the simple select, the advanced editor, or nothing", async () => {
    expect(await refused({ loopDays: 30 })).toEqual([]);
    expect(await refused({ classes: { audit: 400, "custom:x": 60 } })).toEqual([]);
    expect(await refused({})).toEqual([]);
  });

  it("refuses days that are not whole, and classes that are not an object", async () => {
    expect(await refused({ loopDays: 7.5 })).toEqual(["loopDays"]);
    expect(await refused({ loopDays: "30" })).toEqual(["loopDays"]);
    expect(await refused({ loopDays: null })).toEqual(["loopDays"]);
    expect(await refused({ classes: [30] })).toEqual(["classes"]);
    expect(await refused({ classes: "audit=400" })).toEqual(["classes"]);
  });
});
