import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
// Types only, so this import is erased and nothing loads before the mocks below.
import type { Discovery } from "@/app/api/discovery";

import { STUB_BASE_URL, clientAnswering, stubClient } from "../helpers/api";

// The resource sits on the server-side client — see `server.test.ts` for what each of these
// three answers. Every case passes its own client; the mocks only make the import succeed.
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { discover } = await import("@/app/api/discovery");

/**
 * Domain discovery — the one public operation this UI calls
 * ([#712](https://github.com/NobuData/ouroboros/issues/712)).
 *
 * The interesting properties are all about what this module *does not* do. It does not
 * normalise, because the service is the one thing that defines what a domain is. It does not
 * reshape, because the answer's uniformity is the contract's anti-enumeration property and
 * anything derived here would be a way to ask *is this company a customer* from a client. And
 * it does not translate a `422`, because the field's own detail is the sentence worth showing.
 */

/** What the service answers for every domain in this release. */
const ANSWER: Discovery = {
  ssoAvailable: false,
  message: "Enterprise SSO is not configured yet — sign in with GitHub for now.",
};

describe("discover", () => {
  it("POSTs the domain to the contract's path", async () => {
    // A `POST` rather than a `GET` for the reason the contract gives: a domain is an
    // organisation's name for itself, and a request line is kept by a proxy log, a browser
    // history and a `Referer` header alike.
    const { client, requests } = clientAnswering(ANSWER);

    await discover("acme.ouroboros.dev", client);

    expect(requests[0]?.url).toBe(`${STUB_BASE_URL}/api/v1/auth/discover`);
    expect(requests[0]?.method).toBe("POST");
  });

  it("sends the domain exactly as it was typed", async () => {
    // The one request body in this API that is *normalised* rather than refused: the service
    // trims, lower-cases and strips the scheme, path, query, fragment and trailing dot before
    // it validates. A second normaliser here would be a second set of rules to keep in step
    // with the one that actually decides.
    const { client, requests } = clientAnswering(ANSWER);

    await discover("  HTTPS://Acme.Ouroboros.dev/login  ", client);

    await expect(requests[0]?.clone().json()).resolves.toEqual({
      domain: "  HTTPS://Acme.Ouroboros.dev/login  ",
    });
  });

  it("hands back the answer unreshaped, because its uniformity is the contract", async () => {
    // No organisation name, no member count, no identifier, nothing conditional — and nothing
    // derived here either. `openapi.yaml` § `discoverDomain` builds the endpoint not to be a
    // tenant-enumeration oracle, and a client that inferred more than was said would be one.
    const { client } = clientAnswering(ANSWER);

    await expect(discover("acme.ouroboros.dev", client)).resolves.toEqual(ANSWER);
  });

  it("reads the #722 branch as readily as the one that happens today", async () => {
    const available: Discovery = {
      ssoAvailable: true,
      message: "Taking you to your identity provider…",
      redirectUrl: "/api/auth/sso/saml2/acme",
    };
    const { client } = clientAnswering(available);

    await expect(discover("acme.ouroboros.dev", client)).resolves.toEqual(available);
  });

  it("throws the service's envelope for a value that is not a domain", async () => {
    const { client } = stubClient(() => ({
      status: 422,
      body: {
        code: "validation_failed",
        message: "The request is not valid. See `details` for each field.",
        details: { domain: ["domain must be a company domain, such as acme.ouroboros.dev"] },
      },
    }));

    const refusal = discover("not-a-domain", client);

    await expect(refusal).rejects.toBeInstanceOf(ApiError);
    await expect(refusal).rejects.toMatchObject({
      status: 422,
      code: "validation_failed",
      details: { domain: ["domain must be a company domain, such as acme.ouroboros.dev"] },
    });
  });

  it("throws what the service answered when it fails outright", async () => {
    const { client } = stubClient(() => ({
      status: 500,
      body: { code: "internal_error", message: "The service failed.", details: {} },
    }));

    await expect(discover("acme.ouroboros.dev", client)).rejects.toMatchObject({
      status: 500,
      code: "internal_error",
    });
  });
});
