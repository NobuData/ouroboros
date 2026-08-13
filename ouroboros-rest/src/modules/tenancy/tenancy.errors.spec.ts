import { readFileSync } from "node:fs";
import { join } from "node:path";

import { HttpStatus } from "@nestjs/common";

import {
  RETIRED_ERRORS,
  TENANCY_ERRORS,
  domainNotFound,
  orgNotFound,
  repoNotFound,
  tenantNotFound,
} from "./tenancy.errors";

/**
 * The codes, and the promise that the document is the registry.
 *
 * A code is only useful if it is stable and if a client can discover what it means. The
 * first is a matter of not renaming them; the second is `openapi.yaml`, and the test below is
 * what makes "documented" a thing CI checks rather than a thing a reviewer notices — a code
 * introduced in this file and never written into the contract fails the build.
 *
 * There is a second direction since [#714](https://github.com/NobuData/ouroboros/issues/714),
 * and it is the one a deletion needs: the codes that left with the routes that raised them
 * must be gone from the document too. A specification still advertising `last_owner` is a
 * client writing a branch for an answer this service can no longer give.
 */

/** The module root, where the authoritative specification is committed. */
const MODULE_ROOT = join(__dirname, "..", "..", "..");

/** The authoritative specification, read once. */
const SPECIFICATION = readFileSync(join(MODULE_ROOT, "openapi.yaml"), "utf8");

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
    expect(SPECIFICATION).toContain(code);
  });

  it.each(RETIRED_ERRORS)("no longer defines %s", (code) => {
    // Member CRUD, workspace creation and `tenant_required` all left this module. A code that
    // came back here would be this service answering a question the organization plugin now
    // owns — the second write path #714 exists to prevent, showing up as an error code first.
    expect(Object.values(TENANCY_ERRORS)).not.toContain(code);
  });

  it.each(RETIRED_ERRORS)("no longer publishes %s in openapi.yaml", (code) => {
    // The other half, and the one a client can see. Deleting the operation and leaving its
    // failure documented would advertise an answer nothing can produce.
    expect(SPECIFICATION).not.toContain(code);
  });
});

describe("the errors", () => {
  it.each([
    ["a missing workspace", tenantNotFound("9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10")],
    ["a missing domain", domainNotFound("4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94")],
    ["a missing organisation", orgNotFound("nobudata")],
    ["a missing repository", repoNotFound("ouroboros")],
  ])("answers 404 for %s", (_case, error) => {
    expect(error.getStatus()).toBe(HttpStatus.NOT_FOUND);
  });

  it("echoes the identifier the caller sent", () => {
    // A UI holding several workspaces open needs to know *which* request failed, and the
    // caller already knows the value — so returning it leaks nothing and saves a guess. The
    // key is `orgId` because that is what the path parameter is called since #714.
    expect(tenantNotFound("9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10").envelope()).toEqual({
      code: TENANCY_ERRORS.tenantNotFound,
      message: "No such workspace.",
      details: { orgId: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10" },
    });
  });

  it("answers a domain of another workspace exactly as one that does not exist", () => {
    // The existence leak this shares with #32's 404-not-403: two callers who guessed and who
    // are entitled must not be able to tell each other apart from the answer.
    expect(domainNotFound("4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94").envelope().code).toBe(
      TENANCY_ERRORS.domainNotFound,
    );
  });

  it("distinguishes a missing organisation from a missing repository", () => {
    // Two 404s under one path, and they are different facts a screen acts on differently:
    // an organisation nobody added is a row to create, a repository nobody has heard of is
    // one the `PATCH` beside the `GET` would create for you.
    expect(orgNotFound("nobudata").envelope().details).toEqual({ login: "nobudata" });
    expect(repoNotFound("ouroboros").envelope().details).toEqual({ name: "ouroboros" });
  });

  it.each([
    tenantNotFound("9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10"),
    domainNotFound("4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94"),
    orgNotFound("nobudata"),
    repoNotFound("ouroboros"),
  ])("writes %p for a person rather than for an operator", (error) => {
    // None of these may name a table, a column, a constraint or a query — the same rule the
    // health probes' `down` messages follow.
    expect(error.envelope().message).not.toMatch(
      /tenant_|github_|organization_|_key|_fkey|_pkey|select|insert|update/i,
    );
    expect(error.envelope().message).toMatch(/^[A-Z].*\.$/);
  });
});
