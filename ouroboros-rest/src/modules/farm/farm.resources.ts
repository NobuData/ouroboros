/**
 * Row → resource, for the farm's identity surface — and the seam that makes *the full token
 * value is returned exactly once* a property rather than a promise.
 *
 * AH.2 ([#250](https://github.com/NobuData/ouroboros/issues/250)). The rows are the
 * database's (snake_case, `Date`s, envelopes); the resources are the contract's (camelCase,
 * ISO 8601, nothing sealed and nothing secret).
 *
 * ---------------------------------------------------------------------------
 * **Two of the mappers here take a row and cannot possibly leak a secret, and one takes a
 * value and can — so it is the one that is shaped oddly.**
 *
 * {@link enrollmentTokenResource} takes an `EnrollmentToken` row. That row carries
 * `token_sealed`, and this mapper does not read it: the mask is computed from the row's
 * **id**, by `maskToken`, which has no parameter a secret could be passed to. So a list is
 * masked because there is no code path through which it could be anything else, rather than
 * because a mapper remembered to omit a field.
 *
 * {@link mintedTokenResource} is the exception and takes the plaintext explicitly, as a second
 * argument, because the mint response is the one place in the product where the value is
 * returned. Making it a separate function with a separate name is the point: `grep
 * mintedTokenResource` finds every place a full enrollment token can reach a response, and
 * there is one.
 *
 * ---------------------------------------------------------------------------
 * **Nothing here maps a CA private key, and nothing here could.** There is no field on any
 * resource below that one would fit in, and `ouroboros/no-ca-key-escape` refuses the name
 * outright in this file. {@link authorityResource} returns the *public* half — the
 * certificate a runner pins and the fingerprint it compares — which is the only thing about
 * an authority any API returns.
 */

import type { EnrollmentToken, FarmAuthority, Runner, RunnerCertificate } from "../db/schema";
import { maskToken } from "./farm.tokens";
import { RENEWAL_LEAD_MS } from "./farm.policy";

/** An enrollment token as the management panel sees it — masked, always. */
export interface EnrollmentTokenResource {
  /** The row's id. Also the public half of the token's own value. */
  readonly id: string;
  /** Which pool it enrols into. */
  readonly poolId: string;
  /** `orb_enroll_••••a4b7` — what mockup 08 renders. Computed from the id, never the value. */
  readonly masked: string;
  /** When it stops working, ISO 8601. */
  readonly expiresAt: string;
  /** How many machines it may enrol. */
  readonly maxUses: number;
  /** How many it has. */
  readonly uses: number;
  /** Whether it was killed before it expired. */
  readonly revoked: boolean;
  /** When, or null. */
  readonly revokedAt: string | null;
  /** Who minted it — `"user".id` — or null if that person has since been deleted. */
  readonly createdBy: string | null;
  /** When, ISO 8601. */
  readonly createdAt: string;
}

/**
 * A token as a list or a read may describe it.
 *
 * @param row - The stored row. Its `token_sealed` is not read — see this file's header.
 * @returns The resource.
 */
export function enrollmentTokenResource(row: EnrollmentToken): EnrollmentTokenResource {
  return {
    id: row.id,
    poolId: row.pool_id,
    masked: maskToken(row.id),
    expiresAt: row.expires_at.toISOString(),
    maxUses: row.max_uses,
    uses: row.uses,
    revoked: row.revoked,
    revokedAt: row.revoked_at?.toISOString() ?? null,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
  };
}

/** The mint response — the one resource in this product that carries a live secret. */
export interface MintedTokenResource extends EnrollmentTokenResource {
  /**
   * The whole `orb_enroll_…` value.
   *
   * **Returned here and nowhere else, ever.** After this response the plaintext exists only
   * in whatever the operator pasted it into; this service holds an envelope it opens to
   * compare against and never to show.
   */
  readonly token: string;
}

/**
 * A token as the request that created it may describe it.
 *
 * @param row - The stored row.
 * @param value - The plaintext, from `mintToken`. The only parameter in this file that is
 *   one, which is what makes this function greppable — see the header.
 * @returns The resource.
 */
export function mintedTokenResource(row: EnrollmentToken, value: string): MintedTokenResource {
  return { ...enrollmentTokenResource(row), token: value };
}

/** The public half of a workspace's farm CA. */
export interface AuthorityResource {
  /** The CA certificate, PEM — what a runner is handed once and pins. */
  readonly certificate: string;
  /** `sha256` over its DER, lowercase hex — what the agent compares on every connection. */
  readonly fingerprint: string;
  /** The start of its validity, ISO 8601. */
  readonly notBefore: string;
  /** The end of it. A fleet-wide deadline, which is why it is published rather than implied. */
  readonly notAfter: string;
}

/**
 * The authority, as anything is ever allowed to see it.
 *
 * @param row - The stored row. `key_sealed` has no field here to reach.
 * @returns The resource.
 */
export function authorityResource(row: FarmAuthority): AuthorityResource {
  return {
    certificate: row.certificate_pem,
    fingerprint: row.fingerprint,
    notBefore: row.not_before.toISOString(),
    notAfter: row.not_after.toISOString(),
  };
}

/** What an agent gets back when it enrols. */
export interface EnrollmentResource {
  /** The runner row's id. What the certificate's `CN` says and what the gateway resolves. */
  readonly runnerId: string;
  /** The name it was enrolled under. */
  readonly name: string;
  /** Which pool it joined — the token's scope, resolved. */
  readonly poolId: string;
  /** `mtls`, or `bearer_fallback` where the workspace permits it. */
  readonly securityMode: "mtls" | "bearer_fallback";
  /** The issued certificate, PEM — present for `mtls` and absent for the fallback. */
  readonly certificate: string | null;
  /** Its serial, or null. */
  readonly serial: string | null;
  /** When it stops being valid, or null. */
  readonly notAfter: string | null;
  /**
   * When the agent should start asking for a new one.
   *
   * Published rather than left to the agent to compute as a fraction of the lifetime, so
   * changing `farm.policy.ts` changes every runner's behaviour without shipping a binary —
   * the same reason `v1.json` publishes the protocol's limits as numbers.
   */
  readonly renewAfter: string | null;
  /**
   * The long-lived bearer secret — **only** on a `bearer_fallback` enrollment, and only in
   * this response. Null on every mTLS enrollment, which is every enrollment by default.
   */
  readonly bearerToken: string | null;
  /** The CA to pin. */
  readonly authority: AuthorityResource;
}

/** What a runner gets back when it renews. */
export interface RenewalResource {
  /** The new certificate, PEM. */
  readonly certificate: string;
  /** Its serial. */
  readonly serial: string;
  /** When it stops being valid. */
  readonly notAfter: string;
  /** When to come back. */
  readonly renewAfter: string;
  /** The CA to pin — re-sent so a renewal is also how a rotated authority reaches a fleet. */
  readonly authority: AuthorityResource;
}

/** One certificate in a runner's history, as an operator sees it. */
export interface RunnerCertificateResource {
  /** The row's id. */
  readonly id: string;
  /** The serial a handshake presents and a revocation names. */
  readonly serial: string;
  /** `sha256` over the DER. */
  readonly fingerprint: string;
  /** `enrollment` or `renewal`. */
  readonly issuedFor: "enrollment" | "renewal";
  /** When it was issued, ISO 8601. */
  readonly issuedAt: string;
  /** When it stops being valid. */
  readonly notAfter: string;
  /** Whether it was revoked — an incident. */
  readonly revoked: boolean;
  /** When, or null. */
  readonly revokedAt: string | null;
  /** Why, or null. One short word: `operator`, `runner_removed`. */
  readonly revocationReason: string | null;
  /** When a renewal replaced it — routine, and not the same as revoked. */
  readonly supersededAt: string | null;
}

/**
 * A certificate, as an operator sees it.
 *
 * @param row - The stored row.
 * @returns The resource.
 */
export function runnerCertificateResource(row: RunnerCertificate): RunnerCertificateResource {
  return {
    id: row.id,
    serial: row.serial,
    fingerprint: row.fingerprint,
    issuedFor: row.issued_for,
    issuedAt: row.issued_at.toISOString(),
    notAfter: row.not_after.toISOString(),
    revoked: row.revoked,
    revokedAt: row.revoked_at?.toISOString() ?? null,
    revocationReason: row.revocation_reason,
    supersededAt: row.superseded_at?.toISOString() ?? null,
  };
}

/**
 * The enrollment response for a runner that got a certificate.
 *
 * @param runner - The row that was created.
 * @param authority - The workspace's CA.
 * @param certificate - What was signed.
 * @returns The resource.
 */
export function mtlsEnrollmentResource(
  runner: Runner,
  authority: FarmAuthority,
  certificate: { pem: string; serial: string; notAfter: Date },
): EnrollmentResource {
  return {
    runnerId: runner.id,
    name: runner.name,
    poolId: runner.pool_id,
    securityMode: "mtls",
    certificate: certificate.pem,
    serial: certificate.serial,
    notAfter: certificate.notAfter.toISOString(),
    renewAfter: renewAfter(certificate.notAfter),
    bearerToken: null,
    authority: authorityResource(authority),
  };
}

/**
 * The enrollment response for a runner that fell back to a bearer token.
 *
 * The CA is still returned: the agent has to verify the *server's* certificate, and the
 * fallback is about the client half of the handshake rather than about trusting nothing.
 *
 * @param runner - The row that was created.
 * @param authority - The workspace's CA.
 * @param bearer - The secret, returned exactly once.
 * @returns The resource.
 */
export function fallbackEnrollmentResource(
  runner: Runner,
  authority: FarmAuthority,
  bearer: string,
): EnrollmentResource {
  return {
    runnerId: runner.id,
    name: runner.name,
    poolId: runner.pool_id,
    securityMode: "bearer_fallback",
    certificate: null,
    serial: null,
    notAfter: null,
    renewAfter: null,
    bearerToken: bearer,
    authority: authorityResource(authority),
  };
}

/**
 * The renewal response.
 *
 * @param authority - The workspace's CA.
 * @param certificate - What was signed.
 * @returns The resource.
 */
export function renewalResource(
  authority: FarmAuthority,
  certificate: { pem: string; serial: string; notAfter: Date },
): RenewalResource {
  return {
    certificate: certificate.pem,
    serial: certificate.serial,
    notAfter: certificate.notAfter.toISOString(),
    renewAfter: renewAfter(certificate.notAfter),
    authority: authorityResource(authority),
  };
}

/**
 * When a runner holding a certificate that expires at a given instant should renew.
 *
 * @param notAfter - The expiry.
 * @returns The instant, ISO 8601.
 */
function renewAfter(notAfter: Date): string {
  return new Date(notAfter.getTime() - RENEWAL_LEAD_MS).toISOString();
}
