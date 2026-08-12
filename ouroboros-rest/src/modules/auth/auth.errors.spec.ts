import { readFileSync } from "node:fs";
import { join } from "node:path";

import { HttpStatus } from "@nestjs/common";

import { AUTH_ERRORS, unauthenticated } from "./auth.errors";

/**
 * The codes the authentication surface answers with, and the two promises made about them.
 *
 * The first is that every code here is in `openapi.yaml`, because the document is the
 * registry a client reads and a code that is not in it is a `switch` case nobody knew to
 * write. The second is the one specific to authentication: **a failed sign-in says as
 * little as it truthfully can**, so none of these messages names a cookie, a field, or
 * which half of a check failed.
 *
 * **Three of the four codes left with #33's OAuth flow.** `oauth_handshake_invalid`,
 * `github_unavailable` and `github_email_unavailable` were `oauth.ts`'s and `github.ts`'s,
 * and [#702](https://github.com/NobuData/ouroboros/issues/702) deleted the files, the
 * codes, the specification entries and these suites together. BetterAuth reports its own
 * failures by redirecting to `/api/auth/error` with the reason in the query string, which
 * is a surface [#711](https://github.com/NobuData/ouroboros/issues/711) publishes rather
 * than one this catalogue describes.
 */

/** The module root, where the authoritative specification is committed. */
const MODULE_ROOT = join(__dirname, "..", "..", "..");

describe("the codes", () => {
  it.each(Object.entries(AUTH_ERRORS))(
    "names %s as %s, lower-case and underscored",
    (_key, code) => {
      expect(code).toMatch(/^[a-z][a-z0-9_]*$/);
    },
  );

  it.each(Object.values(AUTH_ERRORS))("documents %s in openapi.yaml", (code) => {
    // The document is the registry, so a code cannot be introduced without being described
    // beside the operation that answers with it.
    const specification = readFileSync(join(MODULE_ROOT, "openapi.yaml"), "utf8");

    expect(specification).toContain(code);
  });

  it("are all distinct", () => {
    const codes = Object.values(AUTH_ERRORS);

    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe("a request with no session", () => {
  it("is a 401 carrying the envelope", () => {
    const error = unauthenticated();

    expect(error.getStatus()).toBe(HttpStatus.UNAUTHORIZED);
    expect(error.envelope()).toEqual({
      code: AUTH_ERRORS.unauthenticated,
      message: "Sign in to continue.",
      details: {},
    });
  });

  it("tells a person what to do rather than what went wrong", () => {
    // Absent, expired, forged, or naming a deleted person: one answer. A client cannot act
    // differently on any of them, and distinguishing them tells whoever is probing which
    // part of their forgery was right.
    expect(unauthenticated().message).not.toMatch(/cookie|expired|signature|token/i);
  });
});

describe("every error here", () => {
  it("carries empty details rather than absent ones", () => {
    expect(unauthenticated().envelope().details).toEqual({});
  });
});
