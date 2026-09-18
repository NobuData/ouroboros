/**
 * A distinguished name — `CN=<runner id>, O=<workspace>`, and the two rules that keep it
 * honest.
 *
 * AH.2 ([#250](https://github.com/NobuData/ouroboros/issues/250)). The issue fixes the
 * subject of a runner's certificate: *`CN` = runner id, `O` = tenant*. That is a small
 * sentence with a security property inside it — the gateway (AH.3,
 * [#251](https://github.com/NobuData/ouroboros/issues/251)) reads the subject to learn which
 * runner of which workspace is connecting, and every value it reads was chosen by this
 * service rather than by the machine presenting the certificate.
 *
 * Which is why **the CSR's own subject is discarded**. A runner asks for a certificate by
 * sending a public key in a PKCS#10 request, and that request carries a subject the runner
 * wrote. `registration.service.ts` never looks at it: the name is composed here from the
 * runner row this service just created and the workspace the token was scoped to. A CSR
 * claiming `CN=<somebody else's runner id>` is signed with the *correct* name, not refused,
 * because there was never a code path in which the claim was consulted.
 *
 * The second rule is that **the attribute values are the ones the encoder can carry**. An
 * organization id is a BetterAuth id and a runner id is a UUID, so neither can contain
 * anything a DER string type would have to escape — but a workspace *name* can, and it is
 * deliberately not in the subject for that reason. `O` carries the workspace's id. A name
 * would be a mutable label inside an immutable certificate, and the day somebody renames a
 * workspace every runner in it would be presenting a stale one.
 */

import { oid, sequence, set, utf8String } from "./der";

/** `id-at-commonName` — the runner's id. */
const COMMON_NAME = "2.5.4.3";

/** `id-at-organizationName` — the workspace's id. See this file's header on why not a name. */
const ORGANIZATION_NAME = "2.5.4.10";

/** `id-at-organizationalUnitName` — what kind of certificate this is. */
const ORGANIZATIONAL_UNIT_NAME = "2.5.4.11";

/**
 * The organizational unit every certificate this CA issues carries.
 *
 * It is not an authorization input — the gateway authorizes on the runner row a serial
 * resolves to, never on a string in a name — and it is not decoration either: a certificate
 * pulled out of a log or a proxy's error page says what issued it and what it was for,
 * without a lookup.
 */
export const RUNNER_UNIT = "ouroboros-runner";

/** The unit on the CA's own self-signed certificate, so the two are distinguishable by eye. */
export const AUTHORITY_UNIT = "ouroboros-farm-ca";

/**
 * A distinguished name this service composes.
 *
 * Three attributes, all required, in the order they are encoded. RFC 5280 gives no ordering
 * rule for the RDNs of a name — what it requires is that the *issuer* of a certificate is
 * byte-identical to the *subject* of its issuer's, which is a property of composing both
 * through this one function rather than of any particular order.
 */
export interface DistinguishedName {
  /** `CN`. A runner's id for a leaf; the authority's own id for the CA. */
  readonly commonName: string;
  /** `O`. The workspace's id — always an id, never a display name. */
  readonly organization: string;
  /** `OU`. {@link RUNNER_UNIT} or {@link AUTHORITY_UNIT}. */
  readonly unit: string;
}

/**
 * Encode a name as a DER `Name`.
 *
 * @param name - The three attributes.
 * @returns `SEQUENCE OF RelativeDistinguishedName`, each a one-element `SET` of an
 *   `AttributeTypeAndValue`. Single-valued RDNs throughout, which is what lets `der.ts`'s
 *   {@link set} avoid implementing DER's set ordering — see its documentation.
 */
export function encodeName(name: DistinguishedName): Buffer {
  return sequence(
    attribute(COMMON_NAME, name.commonName),
    attribute(ORGANIZATION_NAME, name.organization),
    attribute(ORGANIZATIONAL_UNIT_NAME, name.unit),
  );
}

/**
 * One `RelativeDistinguishedName` holding one attribute.
 *
 * @param type - The attribute's object identifier.
 * @param value - Its value, encoded as a `UTF8String` — see `der.ts` on why one string type
 *   rather than the narrowest that fits.
 * @returns The encoded RDN.
 */
function attribute(type: string, value: string): Buffer {
  return set(sequence(oid(type), utf8String(value)));
}

/**
 * The subject a runner's certificate carries.
 *
 * @param runnerId - The runner row's id. The gateway resolves a connection to a runner
 *   through this, so it is the id and not the operator-chosen name: names are unique per
 *   workspace and renameable, and a certificate outlives a rename.
 * @param organizationId - The workspace.
 * @returns The name.
 */
export function runnerSubject(runnerId: string, organizationId: string): DistinguishedName {
  return { commonName: runnerId, organization: organizationId, unit: RUNNER_UNIT };
}

/**
 * The subject — and therefore the issuer of everything it signs — of a workspace's farm CA.
 *
 * @param organizationId - The workspace. One CA per workspace, so the id is also the CA's
 *   own name; there is nothing else to distinguish it from.
 * @returns The name.
 */
export function authoritySubject(organizationId: string): DistinguishedName {
  return {
    commonName: `${AUTHORITY_UNIT}:${organizationId}`,
    organization: organizationId,
    unit: AUTHORITY_UNIT,
  };
}
