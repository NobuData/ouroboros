/**
 * A real certificate authority, a real runner keypair and a real certification request — the
 * fixture every suite in this module is built on.
 *
 * AH.2 ([#250](https://github.com/NobuData/ouroboros/issues/250)). Nothing here is a
 * stand-in. The CA is generated with `node:crypto`, the certificates are signed by this
 * module's own encoder, and the certification request is composed the way a Go agent composes
 * one — because the claims these suites make are about cryptography, and a fake certificate
 * would let every one of them pass without the cryptography working.
 *
 * It is a fixture rather than a `beforeEach` because generating a keypair and signing twice
 * costs a few milliseconds and several suites need the same pair. `keypair()` is exported for
 * the cases that need a *second*, distinct identity — the forged-certificate tests, which are
 * only meaningful against a key the CA did not certify.
 *
 * Not shipped: `tsconfig.build.json` excludes `*.fixture.ts` alongside the specs.
 */

import {
  generateKeyPairSync,
  sign,
  type KeyObject,
  type KeyPairKeyObjectResult,
} from "node:crypto";

import type { FarmAuthority, Runner, RunnerCertificate } from "../db/schema";
import { CURVE, newSerial, runnerUri, selfSignedAuthority } from "./x509/certificate";
import { issueRunnerCertificate } from "./x509/certificate";
import { authoritySubject, runnerSubject } from "./x509/name";
import { toPem } from "./x509/pem";
import { oid, sequence, integer, bitString, explicit } from "./x509/der";
import { encodeName } from "./x509/name";
import { CSR_LABEL } from "./x509/csr";

/** The workspace every fixture below belongs to. A BetterAuth id, which is opaque text. */
export const FIXTURE_ORGANIZATION = "org_5eed0001";

/** The runner the fixture certificate names. */
export const FIXTURE_RUNNER = "9c4ab7f0-2d31-4e55-8a0b-6f1c2d3e4a5b";

/** A moment every window in this module is placed around. */
export const FIXTURE_NOW = new Date("2026-09-18T12:00:00.000Z");

/**
 * A fresh P-256 keypair.
 *
 * @returns The pair. Exported so a suite can build an identity this CA never certified,
 *   which is the only way to test that a forged certificate is refused.
 */
export function keypair(): KeyPairKeyObjectResult {
  return generateKeyPairSync("ec", { namedCurve: CURVE });
}

/** A certificate authority, and everything a suite needs to use or impersonate it. */
export interface FixtureAuthority {
  /** The row, as `farm_authorities` holds it — with a plausible sealed key. */
  readonly row: FarmAuthority;
  /** Its private key, for a suite that signs something itself. */
  readonly privateKey: KeyObject;
  /** Its public key. */
  readonly publicKey: KeyObject;
  /** The certificate, PEM. */
  readonly pem: string;
}

/**
 * What a sealed column looks like without anything having been sealed.
 *
 * Shaped to satisfy V041's `farm_authorities_key_sealed`, which is what the *database*
 * enforces; the suites that use it stub `VaultService`, so nothing ever opens it. A real
 * envelope here would mean every unit suite needing a master key.
 */
export const FIXTURE_SEALED =
  "ouro.v1.1.Zml4dHVyZS1ub25jZQ.Zml4dHVyZS12YWx1ZS1ub3QtYS1yZWFsLXNlY3JldA";

/**
 * Generate a workspace's authority.
 *
 * @param organizationId - The workspace.
 * @param at - The instant its window is placed around.
 * @returns The authority.
 */
export function authority(
  organizationId: string = FIXTURE_ORGANIZATION,
  at: Date = FIXTURE_NOW,
): FixtureAuthority {
  const pair = keypair();
  const notBefore = new Date(at.getTime() - 60_000);
  const notAfter = new Date(at.getTime() + 3_650 * 86_400_000);

  const certificate = selfSignedAuthority(
    {
      subject: authoritySubject(organizationId),
      privateKey: pair.privateKey,
      publicKey: pair.publicKey,
      notBefore,
      notAfter,
    },
    newSerial(),
  );

  const pem = toPem("CERTIFICATE", certificate.der);

  return {
    row: {
      organization_id: organizationId,
      certificate_pem: pem,
      key_sealed: FIXTURE_SEALED,
      serial: certificate.serial,
      fingerprint: certificate.fingerprint,
      not_before: notBefore,
      not_after: notAfter,
      created_at: notBefore,
    },
    privateKey: pair.privateKey,
    publicKey: pair.publicKey,
    pem,
  };
}

/** A runner certificate, signed for real. */
export interface FixtureCertificate {
  /** The certificate, PEM — what a peer presents. */
  readonly pem: string;
  /** Its serial, lowercase hex. */
  readonly serial: string;
  /** The row, as `runner_certificates` holds it. */
  readonly row: RunnerCertificate;
}

/**
 * Sign a runner certificate with a fixture authority.
 *
 * @param issuer - The authority.
 * @param options - Which runner, which key, and what window — each defaulted to the ordinary
 *   case so a suite states only the thing it is varying.
 * @returns The certificate.
 */
export function certificate(
  issuer: FixtureAuthority,
  options: {
    runnerId?: string;
    organizationId?: string;
    publicKey?: KeyObject;
    notBefore?: Date;
    notAfter?: Date;
    signingKey?: KeyObject;
  } = {},
): FixtureCertificate {
  const organizationId = options.organizationId ?? issuer.row.organization_id;
  const runnerId = options.runnerId ?? FIXTURE_RUNNER;
  const notBefore = options.notBefore ?? new Date(FIXTURE_NOW.getTime() - 60_000);
  const notAfter = options.notAfter ?? new Date(FIXTURE_NOW.getTime() + 90 * 86_400_000);
  const signer = options.signingKey ?? issuer.privateKey;

  const issued = issueRunnerCertificate(
    {
      subject: runnerSubject(runnerId, organizationId),
      issuer: authoritySubject(issuer.row.organization_id),
      publicKey: options.publicKey ?? keypair().publicKey,
      authorityKey: signer,
      authorityPublicKey: issuer.publicKey,
      notBefore,
      notAfter,
      uri: runnerUri(organizationId, runnerId),
    },
    newSerial(),
  );

  return {
    pem: toPem("CERTIFICATE", issued.der),
    serial: issued.serial,
    row: {
      id: "5eed002a-0000-4000-8000-000000000001",
      organization_id: organizationId,
      runner_id: runnerId,
      serial: issued.serial,
      fingerprint: issued.fingerprint,
      issued_for: "enrollment",
      not_before: notBefore,
      not_after: notAfter,
      issued_at: notBefore,
      revoked: false,
      revoked_at: null,
      revoked_by: null,
      revocation_reason: null,
      superseded_at: null,
    },
  };
}

/**
 * A runner row.
 *
 * @param overrides - What this suite is varying.
 * @returns The row.
 */
export function runner(overrides: Partial<Runner> = {}): Runner {
  return {
    id: FIXTURE_RUNNER,
    organization_id: FIXTURE_ORGANIZATION,
    pool_id: "5eed0024-0000-4000-8000-000000000001",
    name: "forge-01",
    arch: "linux/arm64",
    status: "offline",
    desired_state: "active",
    last_seen_at: null,
    agent_version: null,
    capabilities: {},
    security_mode: "mtls",
    cert_serial: "4a110e97",
    bearer_sealed: null,
    enrolled_at: FIXTURE_NOW,
    enrolled_by: null,
    uptime_seconds: null,
    telemetry: {},
    created_at: FIXTURE_NOW,
    updated_at: FIXTURE_NOW,
    ...overrides,
  };
}

/**
 * A PKCS#10 certification request, composed the way an agent composes one.
 *
 * Built here rather than shelled out to `openssl`, so the suites run on a machine that has
 * none — and built out of this module's own DER encoder, which is not circular: what a CSR
 * suite asserts is that the *parser* reads what a conforming encoder wrote, and every
 * structure below is the one RFC 2986 specifies rather than one invented to match the parser.
 *
 * @param key - The keypair to request a certificate for.
 * @param commonName - The subject to claim. Ignored by everything that reads the request,
 *   which is the point of being able to set it: a suite claims somebody else's name and
 *   asserts the issued certificate does not carry it.
 * @returns The request, PEM.
 */
export function certificationRequest(
  key: KeyPairKeyObjectResult = keypair(),
  commonName = "whatever-the-agent-felt-like",
): string {
  const algorithm = sequence(oid("1.2.840.10045.4.3.2"));

  const info = sequence(
    integer(0),
    encodeName({ commonName, organization: "claimed-by-the-agent", unit: "claimed" }),
    key.publicKey.export({ type: "spki", format: "der" }),
    // `attributes [0] IMPLICIT` — empty, which is what an agent asking for nothing sends.
    explicit(0, Buffer.alloc(0)),
  );

  const request = sequence(info, algorithm, bitString(sign("sha256", info, key.privateKey)));

  return toPem(CSR_LABEL, request);
}

/**
 * A private key in the PEM form `farm.authority.ts` seals.
 *
 * @param key - The key.
 * @returns The PKCS#8 PEM.
 */
export function privateKeyPem(key: KeyObject): string {
  return toPem("PRIVATE KEY", key.export({ type: "pkcs8", format: "der" }));
}
