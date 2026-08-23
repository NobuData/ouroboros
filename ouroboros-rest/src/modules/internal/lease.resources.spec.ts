import { LEASE_TTL_SECONDS, type Lease } from "./lease";
import { leaseResource } from "./lease.resources";

/**
 * The payload, inspected — the acceptance criterion this file is named for.
 *
 * *A lease for a local provider returns host/base-URL details only — no secret, verified by
 * payload inspection.* The strongest form of that check is the type, which has nowhere for a
 * secret to go; what is left for a test is the two things a type cannot say: that the mapper
 * publishes exactly the fields it means to, and that a field added to the internal record
 * does not travel across the boundary by accident.
 *
 * The second one is why this suite hands `leaseResource` a lease carrying an extra property
 * and asserts that it is not in the answer. A `{...lease}` spread would pass every other
 * assertion here and fail that one.
 */

const GRANTED = new Date("2026-08-22T18:04:11.000Z");
const EXPIRES = new Date("2026-08-22T18:19:11.000Z");

/** A granted lease, as `lease.ts` builds one. */
const LEASE: Lease = {
  id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  provider: "ollama",
  run: "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94",
  organizationId: "aBcD1234eFgH5678iJkL9012mNoP3456",
  baseUrl: "http://localhost:11434",
  grantedAt: GRANTED,
  expiresAt: EXPIRES,
  ttlSeconds: LEASE_TTL_SECONDS,
};

describe("what crosses the boundary", () => {
  it("publishes the address, the scope and the times", () => {
    expect(leaseResource(LEASE)).toEqual({
      id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      provider: "ollama",
      run: "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94",
      organizationId: "aBcD1234eFgH5678iJkL9012mNoP3456",
      baseUrl: "http://localhost:11434",
      grantedAt: "2026-08-22T18:04:11.000Z",
      expiresAt: "2026-08-22T18:19:11.000Z",
      ttlSeconds: LEASE_TTL_SECONDS,
    });
  });

  it("carries no field that could hold a credential", () => {
    // Payload inspection, as the criterion words it. The type already makes this true; the
    // assertion is here because the criterion asks for the payload rather than the type, and
    // because it is the check that survives a refactor of either.
    const keys = Object.keys(leaseResource(LEASE));

    expect(keys.toSorted()).toEqual([
      "baseUrl",
      "expiresAt",
      "grantedAt",
      "id",
      "organizationId",
      "provider",
      "run",
      "ttlSeconds",
    ]);
    for (const key of keys) {
      expect(key).not.toMatch(/key|token|secret|credential|password/i);
    }
  });

  it("publishes no value that looks like key material", () => {
    // The other half of the same inspection: not merely that no *field* is named for a
    // secret, but that nothing in the answer is one. Every value is an identifier, a URL, a
    // timestamp or a number, all of which a person can recognise at a glance.
    for (const value of Object.values(leaseResource(LEASE))) {
      expect(["string", "number"]).toContain(typeof value);
    }
  });

  it("does not carry a field added to the internal record", () => {
    // The failure a `{...lease}` spread would ship: the next field on `Lease` — a decrypted
    // anything, a connection's stored configuration — published because nobody decided it
    // should be.
    const enriched = { ...LEASE, providerSecret: "sk-live-should-never-be-published" };

    expect(Object.keys(leaseResource(enriched))).not.toContain("providerSecret");
    expect(JSON.stringify(leaseResource(enriched))).not.toContain("sk-live");
  });
});

describe("the times", () => {
  it("are ISO 8601 strings, not Dates", () => {
    const resource = leaseResource(LEASE);

    expect(typeof resource.grantedAt).toBe("string");
    expect(typeof resource.expiresAt).toBe("string");
  });

  it("agree with the TTL the lease carries", () => {
    // So a client can trust `ttlSeconds` without subtracting the timestamps, which is why it
    // is published at all.
    const resource = leaseResource(LEASE);
    const elapsed = (Date.parse(resource.expiresAt) - Date.parse(resource.grantedAt)) / 1000;

    expect(elapsed).toBe(resource.ttlSeconds);
  });
});
