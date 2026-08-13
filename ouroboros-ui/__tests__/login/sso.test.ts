import { describe, expect, it } from "vitest";

import type { Discovery } from "@/app/api/discovery";
import { ApiError } from "@/app/api/errors";
import {
  DISCOVERY_UNREACHABLE,
  DISCOVERY_WAITING,
  DOMAIN_FIELD,
  DOMAIN_REQUIRED,
  isSafeDestination,
  refusalMessage,
  ssoDestination,
} from "@/app/login/sso";

/**
 * What step 1's SSO half decides, without a form or a service in the way.
 *
 * The module exists so that these are unit tests rather than submissions to drive — the same
 * split `app/login/view.ts` takes for the other card — and the two things worth holding are
 * the ones a later edit could quietly undo:
 *
 *   * **The `ssoAvailable: true` branch is real code today**, even though nothing answers
 *     `true` in this release. [#722](https://github.com/NobuData/ouroboros/issues/722) is what
 *     starts, and #723 is what must then find nothing to change.
 *   * **Nothing here invents the "SSO is not configured" sentence.** That is the service's to
 *     say, and a constant that said it was the thing #718 deleted.
 */

/** An answer from the discovery endpoint, with only what a case cares about stated. */
function discovery(over: Partial<Discovery> = {}): Discovery {
  return {
    ssoAvailable: false,
    message: "Enterprise SSO is not configured yet — sign in with GitHub for now.",
    ...over,
  };
}

describe("the state the form begins in", () => {
  it("has been told nothing, which is not the same as having been told no", () => {
    // The distinction the deleted constant could not make: before a domain is submitted there
    // is no answer, and the card renders neither branch rather than the unavailable one.
    expect(DISCOVERY_WAITING).toEqual({ status: "waiting" });
  });
});

describe("ssoDestination", () => {
  it("goes nowhere while SSO is unavailable, which is every answer this release sends", () => {
    expect(ssoDestination(discovery({ ssoAvailable: false }))).toBeUndefined();
  });

  it("ignores a redirect on an answer that said SSO was unavailable", () => {
    // The flag is the discriminator, not the presence of the field. An answer carrying both
    // is the service contradicting itself, and following the URL would be this client
    // choosing the half that navigates.
    expect(
      ssoDestination(discovery({ ssoAvailable: false, redirectUrl: "/api/auth/sso/saml2/acme" })),
    ).toBeUndefined();
  });

  it("follows the identity provider once SSO is available — the #722 branch", () => {
    expect(
      ssoDestination(discovery({ ssoAvailable: true, redirectUrl: "/api/auth/sso/saml2/acme" })),
    ).toBe("/api/auth/sso/saml2/acme");
  });

  it("follows an absolute one, because an identity provider is somewhere else", () => {
    expect(
      ssoDestination(discovery({ ssoAvailable: true, redirectUrl: "https://acme.okta.com/sso" })),
    ).toBe("https://acme.okta.com/sso");
  });

  it("goes nowhere when SSO is available and nothing was named", () => {
    // Not an error: the contract calls `message` "what the card shows while the browser is on
    // its way", which is the right thing to be looking at if it never leaves.
    expect(ssoDestination(discovery({ ssoAvailable: true }))).toBeUndefined();
    expect(ssoDestination(discovery({ ssoAvailable: true, redirectUrl: "" }))).toBeUndefined();
  });

  it("refuses a scheme a browser would execute rather than fetch", () => {
    for (const url of ["javascript:alert(1)", "data:text/html,<script>", "vbscript:x"]) {
      expect(ssoDestination(discovery({ ssoAvailable: true, redirectUrl: url })), url).toBeUndefined();
    }
  });
});

describe("isSafeDestination", () => {
  it("admits a path on this origin, which is the contract's own example shape", () => {
    expect(isSafeDestination("/api/auth/sso/saml2/acme")).toBe(true);
  });

  it("refuses an authority wearing a path's clothes", () => {
    // `//evil.test` is protocol-relative and resolves to another host; browsers treat the
    // backslash pair the same way. The same two `safeReturnTo` refuses, for the same reason.
    expect(isSafeDestination("//evil.test/sso")).toBe(false);
    expect(isSafeDestination("/\\evil.test/sso")).toBe(false);
  });

  it("admits http and https, because that is what an identity provider is", () => {
    expect(isSafeDestination("https://acme.okta.com/sso")).toBe(true);
    expect(isSafeDestination("http://localhost:4000/sso")).toBe(true);
  });

  it("refuses anything that is neither", () => {
    expect(isSafeDestination("javascript:alert(1)")).toBe(false);
    expect(isSafeDestination("not a url at all")).toBe(false);
    expect(isSafeDestination("")).toBe(false);
  });
});

describe("refusalMessage", () => {
  it("prefers the 422 detail naming the field over the envelope's summary", () => {
    // The envelope says "see `details` for each field", which is a sentence for a client and
    // not for the person who has just mistyped one field.
    const named = "domain must be a company domain, such as acme.ouroboros.dev";

    expect(
      refusalMessage(
        new ApiError(422, "validation_failed", "The request is not valid.", {
          [DOMAIN_FIELD]: [named],
        }),
      ),
    ).toBe(named);
  });

  it("falls back to the envelope's message when no field was named", () => {
    expect(refusalMessage(new ApiError(500, "internal_error", "The service failed."))).toBe(
      "The service failed.",
    );
  });

  it("ignores a details entry that is not a list of sentences", () => {
    expect(
      refusalMessage(
        new ApiError(422, "validation_failed", "The request is not valid.", {
          [DOMAIN_FIELD]: { unexpected: true },
        }),
      ),
    ).toBe("The request is not valid.");
    expect(
      refusalMessage(
        new ApiError(422, "validation_failed", "The request is not valid.", {
          [DOMAIN_FIELD]: [""],
        }),
      ),
    ).toBe("The request is not valid.");
  });

  it("says we could not ask when nothing answered at all", () => {
    // A `TypeError` from a dropped connection has no envelope, and the message it does carry
    // ("Failed to fetch") is not a sentence for a person.
    expect(refusalMessage(new TypeError("Failed to fetch"))).toBe(DISCOVERY_UNREACHABLE);
    expect(refusalMessage(undefined)).toBe(DISCOVERY_UNREACHABLE);
  });

  it("never claims SSO is unconfigured, which is the service's answer and not this one", () => {
    // The property the deleted `SSO_UNAVAILABLE` constant violated by construction: a client
    // that says this is right today by luck and wrong the moment #722 lands.
    for (const copy of [DISCOVERY_UNREACHABLE, DOMAIN_REQUIRED]) {
      expect(copy).not.toMatch(/not configured/i);
    }
  });
});
