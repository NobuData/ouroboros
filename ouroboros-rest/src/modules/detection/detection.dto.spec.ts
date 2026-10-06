/** What a detection request may contain ([#384](https://github.com/NobuData/ouroboros/issues/384)). */

import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import {
  DetectionRepoQuery,
  MAX_PROTECTED_GLOBS,
  MAX_SCAN_SEQ,
  ProtectedPathsDto,
  ScanSeqParams,
} from "./detection.dto";

/** The properties a body fails on. */
async function failing<T extends object>(type: new () => T, body: object): Promise<string[]> {
  const errors = await validate(plainToInstance(type, body));

  return errors.map((error) => error.property);
}

describe("the repo query", () => {
  it("is the onboarding wizard's, so the /onboarding surface has one grammar", async () => {
    await expect(
      failing(DetectionRepoQuery, { repo: "acme-robotics/helios-firmware" }),
    ).resolves.toEqual([]);
    await expect(failing(DetectionRepoQuery, { repo: "../x" })).resolves.toEqual(["repo"]);
  });
});

describe("the scan number", () => {
  it.each(["1", "42", String(MAX_SCAN_SEQ)])("accepts %s from a path", async (scanSeq) => {
    await expect(failing(ScanSeqParams, { scanSeq })).resolves.toEqual([]);
  });

  it.each(["0", "-1", "1.5", "abc", String(MAX_SCAN_SEQ + 1)])("refuses %s", async (scanSeq) => {
    await expect(failing(ScanSeqParams, { scanSeq })).resolves.toEqual(["scanSeq"]);
  });
});

describe("the protected-path list", () => {
  it("takes a list of strings — the empty list too; grammar is the service's to judge", async () => {
    await expect(failing(ProtectedPathsDto, { globs: ["boot/**", "keys/**"] })).resolves.toEqual(
      [],
    );
    await expect(failing(ProtectedPathsDto, { globs: [] })).resolves.toEqual([]);
    await expect(failing(ProtectedPathsDto, { globs: ["/etc/**"] })).resolves.toEqual([]);
  });

  it.each([
    ["missing", {}],
    ["not a list", { globs: "boot/**" }],
    ["a non-string entry", { globs: ["boot/**", 7] }],
    [
      "over the bound",
      { globs: Array.from({ length: MAX_PROTECTED_GLOBS + 1 }, (_, i) => `d${String(i)}/**`) },
    ],
  ])("refuses a list %s", async (_label, body) => {
    await expect(failing(ProtectedPathsDto, body)).resolves.toEqual(["globs"]);
  });
});
