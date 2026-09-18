import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  clientCertificateRequired,
  enrollmentRefused,
  fallbackNotPermitted,
  identityRefused,
  invalidCsr,
  noLiveCertificate,
  poolNotFound,
  runnerNameTaken,
  runnerNotFound,
  tokenNotFound,
  FARM_ERRORS,
} from "./farm.errors";
import { FIXTURE_ORGANIZATION } from "./farm.fixture";

/**
 * The vocabulary, and the property the whole file is shaped by: **an unauthenticated caller
 * learns nothing about this workspace from a refusal**.
 *
 * Two things are asserted. Every code is in `openapi.yaml`, because the document is the
 * registry a client reads and a code that is not in it is a code nobody can look up. And the
 * one refusal an enrolling machine can provoke carries no detail, in any of its six states.
 */

/** The module root, as every error suite in this service resolves it. */
const MODULE_ROOT = join(__dirname, "..", "..", "..");

const SPECIFICATION = readFileSync(join(MODULE_ROOT, "openapi.yaml"), "utf8");

describe("the codes", () => {
  it.each(Object.values(FARM_ERRORS))("documents %s in openapi.yaml", (code) => {
    expect(SPECIFICATION).toContain(code);
  });

  it("has no duplicates, so a client cannot match one code to two meanings", () => {
    const codes = Object.values(FARM_ERRORS);

    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe("the one refusal a stranger can provoke", () => {
  const refusal = enrollmentRefused();

  it("is a 401 — a credential was presented and did not authenticate", () => {
    // Not a 403, which would say *we know who you are and you may not* — a claim this endpoint
    // is never in a position to make.
    expect(refusal.getStatus()).toBe(401);
  });

  it("carries no details at all", () => {
    // Six states behind one answer. Which of the six it was goes to the audit trail.
    expect(refusal.envelope().details).toEqual({});
  });

  it("says nothing about the token, the pool or the workspace", () => {
    const words = JSON.stringify(refusal.envelope()).toLowerCase();

    for (const leak of ["expired", "revoked", "pool", "spent", "uses", "workspace"]) {
      expect(words).not.toContain(leak);
    }
  });
});

describe("the refusals that are safe to explain", () => {
  it("tells an agent author what is wrong with their certificate request", () => {
    // The shape of a CSR is the caller's own business and reveals nothing about this
    // workspace, so an agent author can tell a broken request from a dead token.
    expect(invalidCsr("A runner key is an EC key on P-256.").getStatus()).toBe(422);
    expect(invalidCsr("A runner key is an EC key on P-256.").envelope().message).toContain("P-256");
  });

  it("tells a caller holding a valid token that this workspace requires certificates", () => {
    // The caller has already proved it holds a live token; an agent behind a
    // certificate-stripping proxy has to be able to tell this from a dead token, or the
    // operator's next step is unknowable.
    expect(fallbackNotPermitted().getStatus()).toBe(403);
    expect(fallbackNotPermitted().envelope().message).toContain("client certificate");
  });

  it("names the proxy when a renewal arrives with no client certificate", () => {
    // The likeliest cause by a wide margin, and the deployment note SECURITY_MODEL.md carries.
    expect(clientCertificateRequired().getStatus()).toBe(401);
    expect(clientCertificateRequired().envelope().message).toContain("proxy");
  });

  it("gives one answer for every dead identity", () => {
    // Unknown, expired, superseded and revoked. The difference tells a caller holding a stolen
    // certificate whether the theft has been noticed.
    expect(identityRefused().getStatus()).toBe(401);
    expect(identityRefused().envelope().details).toEqual({});
  });
});

describe("the operator's refusals", () => {
  it("echoes a pool name, because it is the caller's own input", () => {
    expect(poolNotFound("pool-a").getStatus()).toBe(404);
    expect(poolNotFound("pool-a").envelope().details).toEqual({ pool: "pool-a" });
  });

  it("answers 404 for a token or a runner this workspace does not have", () => {
    expect(tokenNotFound().getStatus()).toBe(404);
    expect(runnerNotFound().getStatus()).toBe(404);
  });

  it("answers 409 for a runner with nothing to revoke", () => {
    // The runner exists and the caller may act on it; the request becomes possible again the
    // moment the runner re-enrols. That is a conflict, not an absence.
    expect(noLiveCertificate().getStatus()).toBe(409);
  });

  it("answers 409 and names the machine when a name is taken", () => {
    // The disclosure is bounded: the caller holds a live token for this workspace and could
    // have found the same fact by trying another name. The alternative — the opaque refusal —
    // would have an installer conclude its token was dead and mint a second one.
    const taken = runnerNameTaken("forge-01");

    expect(taken.getStatus()).toBe(409);
    expect(taken.envelope().details).toEqual({ name: "forge-01" });
    expect(JSON.stringify(taken.envelope())).not.toContain(FIXTURE_ORGANIZATION);
  });
});
