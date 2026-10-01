import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { InsightsQuery } from "./page.dto";

/** The page's query: `range` is optional and closed; `repo` is optional and `owner/name`. */

async function refusalsOf(query: unknown): Promise<string[]> {
  const errors = await validate(plainToInstance(InsightsQuery, query));

  return errors.map((error) => error.property);
}

describe("the insights query", () => {
  it.each([["7d"], ["30d"], ["90d"]])("accepts range %s", async (range) => {
    await expect(refusalsOf({ range })).resolves.toEqual([]);
  });

  it("accepts no range and no repo — the page opens on 30d, for the workspace", async () => {
    await expect(refusalsOf({})).resolves.toEqual([]);
  });

  // `custom` is the mockup's fourth segment; date-picker ranges are BL.3's.
  it.each([["custom"], ["1y"], ["30"], [""], ["30D"]])(
    "refuses range %p, naming the field",
    async (range) => {
      await expect(refusalsOf({ range })).resolves.toEqual(["range"]);
    },
  );

  it.each([["acme-robotics/helios-firmware"], ["Acme/Helios.FW"], ["a/b"]])(
    "accepts repo %s",
    async (repo) => {
      await expect(refusalsOf({ repo })).resolves.toEqual([]);
    },
  );

  it.each([
    ["helios-firmware"],
    ["../etc"],
    ["acme/.."],
    ["acme/ helios"],
    [""],
    [`a/${"b".repeat(260)}`],
  ])("refuses repo %p, naming the field", async (repo) => {
    await expect(refusalsOf({ repo })).resolves.toEqual(["repo"]);
  });
});
