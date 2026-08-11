import { readFileSync } from "node:fs";
import { join } from "node:path";

import { HttpStatus } from "@nestjs/common";

import {
  TENANCY_ERRORS,
  domainNotFound,
  lastOwner,
  memberNotFound,
  orgNotFound,
  tenantNotFound,
} from "./tenancy.errors";

/**
 * The codes, and the promise that the document is the registry.
 *
 * A code is only useful if it is stable and if a client can discover what it means. The
 * first is a matter of not renaming them; the second is `openapi.yaml`, and the last test
 * here is what makes "documented" a thing CI checks rather than a thing a reviewer notices —
 * a code introduced in this file and never written into the contract fails the build.
 */

/** The module root, where the authoritative specification is committed. */
const MODULE_ROOT = join(__dirname, "..", "..", "..");

describe("the codes", () => {
  it.each(Object.entries(TENANCY_ERRORS))(
    "names %s as a stable, machine-readable %s",
    (_key, code) => {
      // Lower-case and underscore-separated, because it is compared as a literal in a client's
      // `switch` and read out loud in a bug report.
      expect(code).toMatch(/^[a-z][a-z_]*[a-z]$/);
    },
  );

  it.each(Object.values(TENANCY_ERRORS))("documents %s in openapi.yaml", (code) => {
    // The document is the registry a client reads, so a code that is not in it is a code
    // nobody can look up. This is the check that keeps the two in step.
    const specification = readFileSync(join(MODULE_ROOT, "openapi.yaml"), "utf8");

    expect(specification).toContain(code);
  });
});

describe("the errors", () => {
  it.each([
    ["a missing tenant", tenantNotFound("9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10")],
    ["a missing domain", domainNotFound("4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94")],
    ["a missing member", memberNotFound("c7b1e2f4-5a63-4d8e-b0c9-7f2a1d3e6b85")],
    ["a missing organisation", orgNotFound("nobudata")],
  ])("answers 404 for %s", (_case, error) => {
    expect(error.getStatus()).toBe(HttpStatus.NOT_FOUND);
  });

  it("echoes the identifier the caller sent", () => {
    // A UI holding several tenants open needs to know *which* request failed, and the
    // caller already knows the value — so returning it leaks nothing and saves a guess.
    expect(tenantNotFound("9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10").envelope()).toEqual({
      code: TENANCY_ERRORS.tenantNotFound,
      message: "No such tenant.",
      details: { tenantId: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10" },
    });
  });

  it("answers a domain of another tenant exactly as one that does not exist", () => {
    // The existence leak this shares with #32's 404-not-403: two callers who guessed and who
    // are entitled must not be able to tell each other apart from the answer.
    expect(domainNotFound("4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94").envelope().code).toBe(
      TENANCY_ERRORS.domainNotFound,
    );
  });

  it("refuses to orphan a tenant with a 409 that says what to do instead", () => {
    const error = lastOwner("c7b1e2f4-5a63-4d8e-b0c9-7f2a1d3e6b85");

    expect(error.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(error.envelope()).toEqual({
      code: TENANCY_ERRORS.lastOwner,
      message: "A tenant must keep at least one owner. Promote another member first.",
      details: { userId: "c7b1e2f4-5a63-4d8e-b0c9-7f2a1d3e6b85" },
    });
  });

  it.each([
    tenantNotFound("9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10"),
    domainNotFound("4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94"),
    memberNotFound("c7b1e2f4-5a63-4d8e-b0c9-7f2a1d3e6b85"),
    orgNotFound("nobudata"),
    lastOwner("c7b1e2f4-5a63-4d8e-b0c9-7f2a1d3e6b85"),
  ])("writes %p for a person rather than for an operator", (error) => {
    // None of these may name a table, a column, a constraint or a query — the same rule the
    // health probes' `down` messages follow.
    expect(error.envelope().message).not.toMatch(
      /tenant_|github_|user_|_key|_fkey|_pkey|select|insert|update/i,
    );
    expect(error.envelope().message).toMatch(/^[A-Z].*\.$/);
  });
});
