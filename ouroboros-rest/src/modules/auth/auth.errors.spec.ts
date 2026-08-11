import { readFileSync } from "node:fs";
import { join } from "node:path";

import { HttpStatus } from "@nestjs/common";

import {
  AUTH_ERRORS,
  emailUnavailable,
  githubUnavailable,
  handshakeInvalid,
  unauthenticated,
} from "./auth.errors";

/**
 * The codes sign-in answers with, and the two promises made about them.
 *
 * The first is that every code here is in `openapi.yaml`, because the document is the
 * registry a client reads and a code that is not in it is a `switch` case nobody knew to
 * write. The second is the one specific to authentication: **a failed sign-in says as
 * little as it truthfully can**, so none of these messages names a cookie, a field, or
 * which half of a check failed.
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

describe("a callback that does not match a handshake", () => {
  it("is a 401, not a 403 — nobody is signed in yet", () => {
    expect(handshakeInvalid().getStatus()).toBe(HttpStatus.UNAUTHORIZED);
    expect(handshakeInvalid().code).toBe(AUTH_ERRORS.handshakeInvalid);
  });

  it("says the link is no longer valid, and not which check refused it", () => {
    const message = handshakeInvalid().message;

    expect(message).toContain("Start again");
    expect(message).not.toMatch(/state|cookie|csrf/i);
  });
});

describe("a failure at GitHub", () => {
  it("is a 502, because nothing here is broken and retrying is reasonable", () => {
    expect(githubUnavailable().getStatus()).toBe(HttpStatus.BAD_GATEWAY);
    expect(emailUnavailable().getStatus()).toBe(HttpStatus.BAD_GATEWAY);
  });

  it("names GitHub, which is the one thing the caller can act on", () => {
    expect(githubUnavailable().message).toContain("GitHub");
    expect(emailUnavailable().message).toContain("GitHub");
  });

  it("tells somebody with no verified address exactly what to fix", () => {
    // The one failure here that is permanent until the person does something: an account
    // with no verified address cannot be matched to an invitation, and guessing at one is
    // the mistake that would be silent and irreversible.
    expect(emailUnavailable().message).toContain("Verify an address on GitHub");
  });
});

describe("every error here", () => {
  it("carries empty details rather than absent ones", () => {
    for (const error of [
      unauthenticated(),
      handshakeInvalid(),
      githubUnavailable(),
      emailUnavailable(),
    ]) {
      expect(error.envelope().details).toEqual({});
    }
  });
});
