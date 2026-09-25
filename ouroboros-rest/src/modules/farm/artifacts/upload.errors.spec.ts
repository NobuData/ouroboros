import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ARTIFACT_ERRORS,
  checksumMismatch,
  jobUnattributed,
  manifestInvalid,
  tooLarge,
  uploadClosed,
  uploadRefused,
} from "./upload.errors";

/**
 * The upload's refusals (#330): every code is in `openapi.yaml`, and the one a stranger can
 * provoke says nothing.
 */

const SPECIFICATION = readFileSync(join(__dirname, "..", "..", "..", "..", "openapi.yaml"), "utf8");

describe("the codes", () => {
  it.each(Object.values(ARTIFACT_ERRORS))("documents %s in openapi.yaml", (code) => {
    expect(SPECIFICATION).toContain(code);
  });

  it("has no duplicates", () => {
    const codes = Object.values(ARTIFACT_ERRORS);

    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe("the refusals", () => {
  it("answers every token failure with one detail-free 401", () => {
    const refusal = uploadRefused();

    expect([refusal.getStatus(), refusal.code, refusal.envelope().details]).toEqual([
      401,
      ARTIFACT_ERRORS.uploadRefused,
      {},
    ]);
    expect(refusal.message).not.toMatch(/expired|closed|another|unknown/i);
  });

  it("answers a replay of the right token with a 409 that says the token is single use", () => {
    expect([uploadClosed().getStatus(), uploadClosed().message]).toEqual([
      409,
      expect.stringContaining("single use") as string,
    ]);
    expect(jobUnattributed().getStatus()).toBe(409);
  });

  it("names the file a corrupted upload failed on, and both checksums", () => {
    const error = checksumMismatch("a.xml", "sha256:aa", "sha256:bb");

    expect([error.getStatus(), error.envelope().details]).toEqual([
      422,
      { file: "a.xml", declared: "sha256:aa", actual: "sha256:bb" },
    ]);
  });

  it("names the file a manifest problem concerns, when it concerns one", () => {
    expect(manifestInvalid("x").envelope().details).toEqual({});
    expect(manifestInvalid("x", "a.log").envelope().details).toEqual({ file: "a.log" });
  });

  it("answers a cap with a 413 that names it", () => {
    expect([
      tooLarge("the per-job cap", 10).getStatus(),
      tooLarge("the per-job cap", 10).message,
    ]).toEqual([413, "The upload is larger than the per-job cap of 10 bytes."]);
    expect(tooLarge("the per-file cap", 5, "big.bin").envelope().details).toEqual({
      file: "big.bin",
      capBytes: 5,
    });
  });
});
