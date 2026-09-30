import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { ApplyRuleImportBody, PreviewRuleImportBody } from "./rule-import.dto";

/**
 * The import routes' request shapes ([#413](https://github.com/NobuData/ouroboros/issues/413)),
 * validated the way the pipe validates them.
 */

/**
 * @param type - The DTO.
 * @param value - The plain value.
 * @returns The names of the failing properties.
 */
async function violations<T extends object>(
  type: new () => T,
  value: Record<string, unknown>,
): Promise<string[]> {
  return (await validate(plainToInstance(type, value))).map((failure) => failure.property);
}

describe("the repository", () => {
  it.each([["acme-robotics/helios-firmware"], ["Acme/Nested/Repo"]])("admits %s", async (repo) => {
    expect(await violations(PreviewRuleImportBody, { repo })).toEqual([]);
  });

  it.each([["helios-firmware"], ["acme/../etc"], ["acme/.."], [""], [42]])(
    "refuses %j",
    async (repo) => {
      expect(await violations(PreviewRuleImportBody, { repo })).toEqual(["repo"]);
    },
  );
});

describe("the fingerprint", () => {
  const repo = "acme-robotics/helios-firmware";

  it("is the preview's lower-case hex sha256", async () => {
    expect(await violations(ApplyRuleImportBody, { repo, fingerprint: "0f".repeat(32) })).toEqual(
      [],
    );
  });

  it.each([[undefined], ["0F".repeat(32)], ["0".repeat(63)], ["g".repeat(64)]])(
    "refuses %j",
    async (fingerprint) => {
      expect(await violations(ApplyRuleImportBody, { repo, fingerprint })).toEqual(["fingerprint"]);
    },
  );

  it("is required alongside the repository", async () => {
    expect((await violations(ApplyRuleImportBody, {})).sort()).toEqual(["fingerprint", "repo"]);
  });
});
