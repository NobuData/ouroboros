import {
  bearerServiceToken,
  SERVICE_PRINCIPAL_PROPERTY,
  SERVICE_TOKEN_REJECTED_PROPERTY,
  servicePrincipalOf,
  serviceTokenRejected,
} from "./service.principal";
import { servicePrincipalFor } from "./service.principal.fixture";

/**
 * The request plumbing a service principal travels on (#485): which bearer counts, and how the
 * guards read what the middleware attached.
 */

const TOKEN = `orb_svc_${"A".repeat(43)}`;

describe("reading a service token off a request", () => {
  it("takes a Bearer token with the service prefix", () => {
    expect(bearerServiceToken({ headers: { authorization: `Bearer ${TOKEN}` } })).toBe(TOKEN);
  });

  it("accepts any capitalisation of the scheme and stray whitespace", () => {
    expect(bearerServiceToken({ headers: { authorization: `  bearer   ${TOKEN} ` } })).toBe(TOKEN);
  });

  it("leaves a bearer of any other kind alone — it is not this guard's to refuse", () => {
    expect(
      bearerServiceToken({ headers: { authorization: "Bearer orb_enroll_abc" } }),
    ).toBeUndefined();
    expect(bearerServiceToken({ headers: { authorization: `Basic ${TOKEN}` } })).toBeUndefined();
  });

  it("finds nothing on a request with no header", () => {
    expect(bearerServiceToken({ headers: {} })).toBeUndefined();
    expect(bearerServiceToken({})).toBeUndefined();
  });

  it("reads the first of a repeated header", () => {
    expect(
      bearerServiceToken({ headers: { authorization: [`Bearer ${TOKEN}`, "Bearer x"] } }),
    ).toBe(TOKEN);
  });
});

describe("what the middleware attached", () => {
  it("is the principal, when one was accepted", () => {
    const principal = servicePrincipalFor();

    expect(servicePrincipalOf({ [SERVICE_PRINCIPAL_PROPERTY]: principal })).toBe(principal);
    expect(servicePrincipalOf({})).toBeUndefined();
  });

  it("is a rejection only when the flag was set", () => {
    expect(serviceTokenRejected({ [SERVICE_TOKEN_REJECTED_PROPERTY]: true })).toBe(true);
    expect(serviceTokenRejected({})).toBe(false);
  });
});
