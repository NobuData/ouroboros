import {
  authorityResource,
  enrollmentTokenResource,
  fallbackEnrollmentResource,
  mintedTokenResource,
  mtlsEnrollmentResource,
  renewalResource,
  runnerCertificateResource,
} from "./farm.resources";
import { RENEWAL_LEAD_MS } from "./farm.policy";
import { mintToken } from "./farm.tokens";
import type { EnrollmentToken } from "../db/schema";
import { authority, certificate, runner, FIXTURE_NOW, FIXTURE_SEALED } from "./farm.fixture";

/**
 * The seam between a row and a response, and the one claim it exists to make: **no sealed
 * column and no secret reaches a payload except in the one response that is supposed to carry
 * one**.
 */

const TOKEN_ID = "7f3a9c1e-4b0d-4e2a-8f6b-5c3d1e0f2a4b";

/**
 * A token row.
 *
 * @param overrides - What a test is varying.
 * @returns The row.
 */
function tokenRow(overrides: Partial<EnrollmentToken> = {}): EnrollmentToken {
  return {
    id: TOKEN_ID,
    organization_id: "org_5eed0001",
    pool_id: "5eed0024-0000-4000-8000-000000000001",
    token_sealed: FIXTURE_SEALED,
    expires_at: new Date(FIXTURE_NOW.getTime() + 86_400_000),
    max_uses: 5,
    uses: 3,
    revoked: false,
    revoked_at: null,
    created_by: "user_ken",
    created_at: FIXTURE_NOW,
    ...overrides,
  };
}

describe("a token as anything but the mint response sees it", () => {
  it("is masked, and the mask is computed from the id", () => {
    expect(enrollmentTokenResource(tokenRow()).masked).toBe("orb_enroll_••••2a4b");
  });

  it("carries no sealed column, in any field", () => {
    // The mapper does not read `token_sealed` at all — the envelope has nowhere to go.
    expect(JSON.stringify(enrollmentTokenResource(tokenRow()))).not.toContain("ouro.v1.");
  });

  it("carries the use count, which is the number an incident turns on", () => {
    // Revoked at zero uses leaked nothing; revoked at four means four machines to account for.
    const revoked = enrollmentTokenResource(
      tokenRow({ revoked: true, revoked_at: FIXTURE_NOW, uses: 4 }),
    );

    expect(revoked.uses).toBe(4);
    expect(revoked.revokedAt).toBe(FIXTURE_NOW.toISOString());
  });

  it("stamps in ISO 8601", () => {
    expect(enrollmentTokenResource(tokenRow()).createdAt).toBe(FIXTURE_NOW.toISOString());
  });

  it("nulls the author rather than inventing one", () => {
    expect(enrollmentTokenResource(tokenRow({ created_by: null })).createdBy).toBeNull();
  });
});

describe("the mint response", () => {
  it("is the only place a value appears, and appears exactly once", () => {
    const token = mintToken(TOKEN_ID);
    const minted = mintedTokenResource(tokenRow(), token.value);

    expect(minted.token).toBe(token.value);
    // The mask is still there beside it, so the panel renders the same string it will see for
    // the rest of this token's life.
    expect(minted.masked).not.toContain(token.secret);
  });

  it("is a separate function, so the one place it can happen is greppable", () => {
    // `mintedTokenResource` is the name to search for; `enrollmentTokenResource` has no
    // parameter a value could be passed to.
    expect(enrollmentTokenResource).toHaveLength(1);
    expect(mintedTokenResource).toHaveLength(2);
  });
});

describe("the authority", () => {
  it("is the public half and has no field a key could occupy", () => {
    const resource = authorityResource(authority().row);

    expect(Object.keys(resource).sort()).toEqual([
      "certificate",
      "fingerprint",
      "notAfter",
      "notBefore",
    ]);
    expect(JSON.stringify(resource)).not.toContain("ouro.v1.");
    expect(JSON.stringify(resource)).not.toContain("PRIVATE KEY");
  });

  it("publishes the CA's expiry, because it is a fleet-wide deadline", () => {
    expect(authorityResource(authority().row).notAfter).toMatch(/^\d{4}-/);
  });
});

describe("an enrollment", () => {
  const issuer = authority();
  const issued = certificate(issuer);

  it("carries the certificate and no bearer token on the mTLS path", () => {
    const resource = mtlsEnrollmentResource(runner(), issuer.row, {
      pem: issued.pem,
      serial: issued.serial,
      notAfter: issued.row.not_after,
    });

    expect(resource.securityMode).toBe("mtls");
    expect(resource.certificate).toBe(issued.pem);
    expect(resource.bearerToken).toBeNull();
  });

  it("publishes when to renew, rather than leaving the agent to guess a fraction", () => {
    // So changing the policy changes every runner's behaviour without shipping a binary.
    const resource = mtlsEnrollmentResource(runner(), issuer.row, {
      pem: issued.pem,
      serial: issued.serial,
      notAfter: issued.row.not_after,
    });

    expect(Date.parse(resource.renewAfter as string)).toBe(
      issued.row.not_after.getTime() - RENEWAL_LEAD_MS,
    );
  });

  it("carries the bearer token and no certificate on the fallback path", () => {
    const resource = fallbackEnrollmentResource(
      runner({ security_mode: "bearer_fallback", cert_serial: null }),
      issuer.row,
      "a-bearer-secret",
    );

    expect(resource.securityMode).toBe("bearer_fallback");
    expect(resource.certificate).toBeNull();
    expect(resource.serial).toBeNull();
    expect(resource.bearerToken).toBe("a-bearer-secret");
  });

  it("returns the CA on the fallback path too", () => {
    // The agent still has to verify the *server's* certificate. The fallback is about the
    // client half of the handshake, not about trusting nothing.
    expect(fallbackEnrollmentResource(runner(), issuer.row, "x").authority.fingerprint).toBe(
      issuer.row.fingerprint,
    );
  });

  it("never carries the runner's sealed bearer secret from the row", () => {
    const sealed = runner({
      security_mode: "bearer_fallback",
      cert_serial: null,
      bearer_sealed: FIXTURE_SEALED,
    });

    expect(JSON.stringify(fallbackEnrollmentResource(sealed, issuer.row, "x"))).not.toContain(
      "ouro.v1.",
    );
  });
});

describe("a renewal", () => {
  it("re-sends the CA, so a rotated authority reaches a fleet through renewals", () => {
    const issuer = authority();
    const issued = certificate(issuer);

    const resource = renewalResource(issuer.row, {
      pem: issued.pem,
      serial: issued.serial,
      notAfter: issued.row.not_after,
    });

    expect(resource.authority.certificate).toBe(issuer.pem);
    expect(resource.renewAfter).toEqual(expect.any(String));
  });
});

describe("a certificate as an operator sees it", () => {
  it("keeps revoked and superseded apart", () => {
    // Superseded is routine — a renewal replaced it — and revoked is an incident. A handshake
    // refuses both; the trail has to tell them apart.
    const issued = certificate(authority());

    const superseded = runnerCertificateResource({ ...issued.row, superseded_at: FIXTURE_NOW });
    const revoked = runnerCertificateResource({
      ...issued.row,
      revoked: true,
      revoked_at: FIXTURE_NOW,
      revocation_reason: "operator",
    });

    expect(superseded.revoked).toBe(false);
    expect(superseded.supersededAt).toBe(FIXTURE_NOW.toISOString());
    expect(revoked.supersededAt).toBeNull();
    expect(revoked.revocationReason).toBe("operator");
  });
});
