import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { CalibrationQuery } from "./calibration.dto";

/** The report's query: `window` is optional and closed. */

async function refusalsOf(query: unknown): Promise<string[]> {
  const errors = await validate(plainToInstance(CalibrationQuery, query));

  return errors.map((error) => error.property);
}

describe("the calibration query", () => {
  it.each([["7d"], ["30d"], ["90d"]])("accepts %s", async (window) => {
    await expect(refusalsOf({ window })).resolves.toEqual([]);
  });

  it("accepts no window — the report opens on 30d", async () => {
    await expect(refusalsOf({})).resolves.toEqual([]);
  });

  it.each([["1y"], ["30"], [""], ["30D"]])("refuses %p, naming the field", async (window) => {
    await expect(refusalsOf({ window })).resolves.toEqual(["window"]);
  });
});
