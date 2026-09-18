import {
  authorityWindow,
  certificateWindow,
  AUTHORITY_LIFETIME_MS,
  BEARER_SECRET_BYTES,
  CERTIFICATE_LIFETIME_MS,
  CLOCK_SKEW_MS,
  DEFAULT_TOKEN_TTL_MS,
  MAX_TOKEN_TTL_MS,
  MAX_TOKEN_USES,
  MIN_TOKEN_TTL_MS,
  RENEWAL_LEAD_MS,
  TOKEN_SECRET_BYTES,
} from "./farm.policy";
import { MAX_TTL_SECONDS, MIN_TTL_SECONDS } from "./farm.dto";
import { FIXTURE_NOW } from "./farm.fixture";

/**
 * The numbers, and the relationships between them that a change to any one of them could
 * break silently.
 *
 * A constant asserted against itself is worthless; what is asserted here is the *shape* — that
 * renewal happens before expiry with room to retry, that the DTO's published bounds are the
 * policy's, that a token's life is shorter than a certificate's. Each of those is a sentence
 * somebody could violate by editing one number.
 */

describe("the certificate lifetime", () => {
  it("leaves room to renew several times before anything expires", () => {
    // Thirty days of lead on ninety days of life: a runner has three chances to replace its
    // certificate before anybody notices, which is what makes expiry a backstop rather than
    // the control. Revocation is the control.
    expect(RENEWAL_LEAD_MS).toBeLessThan(CERTIFICATE_LIFETIME_MS);
    expect(CERTIFICATE_LIFETIME_MS / RENEWAL_LEAD_MS).toBeGreaterThanOrEqual(3);
  });

  it("is much shorter than the authority's", () => {
    // A CA expiring is a fleet-wide outage with no partial failure to warn anybody first.
    expect(AUTHORITY_LIFETIME_MS).toBeGreaterThan(CERTIFICATE_LIFETIME_MS * 10);
  });
});

describe("a validity window", () => {
  it("starts in the past, for the clock on a machine this control plane does not administer", () => {
    const window = certificateWindow(FIXTURE_NOW);

    expect(window.notBefore.getTime()).toBe(FIXTURE_NOW.getTime() - CLOCK_SKEW_MS);
    expect(window.notAfter.getTime()).toBe(FIXTURE_NOW.getTime() + CERTIFICATE_LIFETIME_MS);
  });

  it("is a positive interval, which the schema also refuses to store otherwise", () => {
    for (const window of [certificateWindow(FIXTURE_NOW), authorityWindow(FIXTURE_NOW)]) {
      expect(window.notAfter.getTime()).toBeGreaterThan(window.notBefore.getTime());
    }
  });
});

describe("a token's bounds", () => {
  it("defaults to the mockup's ttl 24h", () => {
    expect(DEFAULT_TOKEN_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("keeps the default inside the range a request may ask for", () => {
    expect(DEFAULT_TOKEN_TTL_MS).toBeGreaterThanOrEqual(MIN_TOKEN_TTL_MS);
    expect(DEFAULT_TOKEN_TTL_MS).toBeLessThanOrEqual(MAX_TOKEN_TTL_MS);
  });

  it("is what the DTO publishes, so the validator and the service cannot disagree", () => {
    // The whole reason this file exists: one number, read by the bound, the service and the
    // contract.
    expect(MIN_TTL_SECONDS * 1000).toBe(MIN_TOKEN_TTL_MS);
    expect(MAX_TTL_SECONDS * 1000).toBe(MAX_TOKEN_TTL_MS);
  });

  it("lives for less time than a certificate does", () => {
    // A token is a bearer secret on a command line and in a shell history; a certificate is a
    // key that never left the machine. The shorter life belongs to the weaker thing.
    expect(MAX_TOKEN_TTL_MS).toBeLessThan(CERTIFICATE_LIFETIME_MS);
  });

  it("is bounded above in uses, because an unlimited token is a password", () => {
    expect(MAX_TOKEN_USES).toBeGreaterThan(1);
    expect(Number.isFinite(MAX_TOKEN_USES)).toBe(true);
  });
});

describe("the secrets", () => {
  it("are 256 bits, both of them", () => {
    expect(TOKEN_SECRET_BYTES).toBe(32);
    expect(BEARER_SECRET_BYTES).toBe(32);
  });
});
