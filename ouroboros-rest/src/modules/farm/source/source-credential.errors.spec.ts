import { readFileSync } from "node:fs";
import { join } from "node:path";

import { SOURCE_CREDENTIAL_ERRORS, sourceCredentialRefused } from "./source-credential.errors";

/** The one refusal (#991), held to `openapi.yaml` the way the upload's are. */

const SPECIFICATION = readFileSync(join(__dirname, "..", "..", "..", "..", "openapi.yaml"), "utf8");

describe("the codes", () => {
  it.each(Object.values(SOURCE_CREDENTIAL_ERRORS))("documents %s in openapi.yaml", (code) => {
    expect(SPECIFICATION).toContain(code);
  });
});

describe("the refusal", () => {
  it("answers every ticket failure with one detail-free 401", () => {
    const refusal = sourceCredentialRefused();

    expect([refusal.getStatus(), refusal.code, refusal.envelope().details]).toEqual([
      401,
      SOURCE_CREDENTIAL_ERRORS.refused,
      {},
    ]);
    expect(refusal.envelope().message).not.toMatch(/expired|redeemed|wrong|another/);
  });
});
