import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { fieldMessages } from "../errors/validation";
import { ALIAS_NAME_MESSAGE, MAX_ALIAS_LENGTH } from "./aliases.dto";
import { LatestResolutionQuery } from "./resolutions.dto";

/**
 * `?alias=` is an alias name or it is a `422` ([#589](https://github.com/NobuData/ouroboros/issues/589)).
 *
 * Refused exactly when no alias could be called it — V015's shape, through `aliases.dto.ts`'s own
 * constants — and never merely because no alias *is* called it: a snapshot outlives the alias it
 * names, so a well-formed unknown name is a question with an answer.
 */

/**
 * Validate a query the way the pipe does.
 *
 * @param query - The query string's fields.
 * @returns Complaints by field; `{}` for an acceptable query.
 */
function complaints(query: Record<string, unknown>): Record<string, string[]> {
  return fieldMessages(
    validateSync(plainToInstance(LatestResolutionQuery, query), {
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
}

describe("LatestResolutionQuery", () => {
  it.each(["coder-max", "gpt5-experiments", "a", "a".repeat(MAX_ALIAS_LENGTH)])(
    "accepts %s",
    (alias) => {
      expect(complaints({ alias })).toEqual({});
    },
  );

  it("accepts a well-formed name no alias carries — history outlives the alias", () => {
    expect(complaints({ alias: "retired-last-year" })).toEqual({});
  });

  it.each([
    ["a raw model id with a colon", "qwen3-coder:32b"],
    ["upper case", "Coder-Max"],
    ["a doubled hyphen", "coder--max"],
    ["an empty name", ""],
    ["JSON that tries to widen the containment", '"},{"alias":"x'],
  ])("refuses %s with the alias-name message", (_what, alias) => {
    expect(complaints({ alias }).alias).toContain(ALIAS_NAME_MESSAGE);
  });

  it("refuses a name longer than an alias may be", () => {
    expect(complaints({ alias: "a".repeat(MAX_ALIAS_LENGTH + 1) }).alias).toBeDefined();
  });

  it("requires the alias", () => {
    expect(complaints({}).alias).toBeDefined();
  });

  it("refuses a field the read does not take", () => {
    expect(complaints({ alias: "coder-max", run: "482" }).run).toBeDefined();
  });
});
