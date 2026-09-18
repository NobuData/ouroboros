import { X509Certificate, generateKeyPairSync } from "node:crypto";

import {
  issueRunnerCertificate,
  newSerial,
  runnerUri,
  selfSignedAuthority,
  CURVE,
  CURVE_JWK,
} from "./certificate";
import { authoritySubject, runnerSubject } from "./name";
import { fromPem, toPem } from "./pem";
import { at, children, read, type Element } from "./reader";
import { TAG } from "./der";
import {
  authority,
  certificate,
  keypair,
  FIXTURE_NOW,
  FIXTURE_ORGANIZATION,
  FIXTURE_RUNNER,
} from "../farm.fixture";

/**
 * The factory, held to what a **verifier** makes of its output rather than to its own bytes.
 *
 * Every assertion here goes through `crypto.X509Certificate`, which is OpenSSL: it parses the
 * DER this module wrote, reads the extensions back, checks the chain and verifies the
 * signature. A suite that compared bytes against bytes would pass for an encoder nothing else
 * in the world can read.
 *
 * The two claims that matter most are the ones an incident would turn on: **a leaf is not a
 * CA**, and **the subject is what this service composed rather than what the request asked
 * for**.
 */

/**
 * One certificate's extensions, by object identifier.
 *
 * Node's `X509Certificate` exposes three of them and this module writes six, so the ones that
 * matter most — `keyUsage` and `extKeyUsage`, which are what a stolen runner key can and
 * cannot be used for — would otherwise go unasserted. Read with this module's own reader,
 * which is legitimate here for the reason it is legitimate in `certificate.ts`: the bytes
 * being walked were produced by this process, and what is under test is the *encoder*.
 *
 * @param pem - The certificate.
 * @returns Each extension's value bytes and whether it is critical, keyed by OID in dotted
 *   form.
 */
function extensions(pem: string): Map<string, { critical: boolean; value: Buffer }> {
  const der = fromPem("CERTIFICATE", pem);
  const tbs = at(children(der, read(der, 0)), 0, "tbsCertificate");
  const fields = children(der, tbs);
  const wrapper = fields.find((field) => field.tag === 0xa3);

  const found = new Map<string, { critical: boolean; value: Buffer }>();
  if (!wrapper) return found;

  for (const extension of children(der, at(children(der, wrapper), 0, "extensions"))) {
    const parts = children(der, extension);
    const critical = parts.length === 3;
    const value = at(parts, critical ? 2 : 1, "extension value");

    found.set(dotted(der, at(parts, 0, "extension id")), {
      critical,
      value: der.subarray(value.contentAt, value.end),
    });
  }

  return found;
}

/**
 * An object identifier's dotted form, decoded from its DER.
 *
 * @param der - The certificate.
 * @param element - The OID element.
 * @returns The dotted form.
 */
function dotted(der: Buffer, element: Element): string {
  const bytes = der.subarray(element.contentAt, element.end);
  const arcs = [Math.floor((bytes[0] ?? 0) / 40), (bytes[0] ?? 0) % 40];

  let value = 0;
  for (const byte of bytes.subarray(1)) {
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) {
      arcs.push(value);
      value = 0;
    }
  }

  return arcs.join(".");
}

/** The identifiers this module writes, named so the assertions read. */
const SUBJECT_KEY_IDENTIFIER = "2.5.29.14";
const KEY_USAGE = "2.5.29.15";
const BASIC_CONSTRAINTS = "2.5.29.19";
const AUTHORITY_KEY_IDENTIFIER = "2.5.29.35";
const EXTENDED_KEY_USAGE = "2.5.29.37";

describe("a workspace's authority", () => {
  const issuer = authority();
  const parsed = new X509Certificate(issuer.pem);

  it("is a certificate authority, and says so with the flag written explicitly", () => {
    // DER omits a `DEFAULT FALSE` field, so a basic-constraints value that encoded `cA` as
    // absent would be a CA certificate claiming it is not one.
    expect(parsed.ca).toBe(true);
  });

  it("is self-signed", () => {
    expect(parsed.checkIssued(parsed)).toBe(true);
    expect(parsed.verify(issuer.publicKey)).toBe(true);
  });

  it("signs certificates and revocation lists, and nothing else", () => {
    // `keyCertSign` (bit 5) and `cRLSign` (bit 6): 0b0000_0110 with one unused low bit. No
    // `digitalSignature`, so the CA key cannot be used to sign anything but certificates.
    const usage = extensions(issuer.pem).get(KEY_USAGE);

    expect(usage?.critical).toBe(true);
    expect(usage?.value).toEqual(Buffer.of(TAG.BIT_STRING, 0x02, 0x01, 0b0000_0110));
  });

  it("may not issue a sub-CA — its path length is zero", () => {
    // The farm CA signs end entities and nothing else. A path length that permitted a sub-CA
    // would be an unused capability in the most sensitive certificate a workspace has.
    const constraints = extensions(issuer.pem).get(BASIC_CONSTRAINTS);

    expect(constraints?.critical).toBe(true);
    expect(constraints?.value).toEqual(
      Buffer.of(TAG.SEQUENCE, 0x06, TAG.BOOLEAN, 0x01, 0xff, TAG.INTEGER, 0x01, 0x00),
    );
  });

  it("is on P-256", () => {
    expect(parsed.publicKey.export({ format: "jwk" }).crv).toBe(CURVE_JWK);
  });

  it("carries a serial that is positive and 128 bits wide", () => {
    expect(parsed.serialNumber).toMatch(/^[0-9A-F]{32}$/);
  });
});

describe("a runner's certificate", () => {
  const issuer = authority();
  const runnerKey = keypair();
  const issued = certificate(issuer, { publicKey: runnerKey.publicKey });
  const parsed = new X509Certificate(issued.pem);

  it("is signed by the workspace's authority", () => {
    const ca = new X509Certificate(issuer.pem);

    expect(parsed.checkIssued(ca)).toBe(true);
    expect(parsed.verify(ca.publicKey)).toBe(true);
  });

  it("is NOT a certificate authority", () => {
    // The single most dangerous thing this file could get wrong: a leaf issued with `cA: TRUE`
    // is a runner that can mint runners.
    expect(parsed.ca).toBe(false);
  });

  it("does not verify against a different workspace's authority", () => {
    expect(parsed.verify(authority("org_somebody_else").publicKey)).toBe(false);
  });

  it("names the runner in its subject and in a machine-readable SAN", () => {
    // A CN is not a machine-readable identifier — RFC 6125 has said so for a decade — so the
    // SAN is where the gateway compares.
    expect(parsed.subject).toContain(`CN=${FIXTURE_RUNNER}`);
    expect(parsed.subjectAltName).toBe(`URI:${runnerUri(FIXTURE_ORGANIZATION, FIXTURE_RUNNER)}`);
  });

  it("is for client authentication only, and for signing only", () => {
    // A runner certificate is an identity for a TLS client handshake. Naming only what is
    // needed is what makes a stolen runner key useless for anything but impersonating that one
    // runner — which revocation then answers.
    const found = extensions(issued.pem);

    expect(found.get(EXTENDED_KEY_USAGE)?.value).toEqual(
      Buffer.from("300a06082b06010505070302", "hex"),
    );
    expect(found.get(KEY_USAGE)?.value).toEqual(Buffer.of(TAG.BIT_STRING, 0x02, 0x07, 0b1000_0000));
    expect(found.get(KEY_USAGE)?.critical).toBe(true);
  });

  it("declares itself an end entity", () => {
    expect(extensions(issued.pem).get(BASIC_CONSTRAINTS)?.value).toEqual(
      Buffer.of(TAG.SEQUENCE, 0x00),
    );
  });

  it("carries the authority's key identifier, so a chain builder can find the issuer", () => {
    // The leaf's AKI holds the same twenty bytes as the issuer's SKI. Both are `[0] IMPLICIT`
    // and `OCTET STRING` respectively, so the payloads are compared past their own headers.
    const aki = extensions(issued.pem).get(AUTHORITY_KEY_IDENTIFIER)?.value;
    const ski = extensions(issuer.pem).get(SUBJECT_KEY_IDENTIFIER)?.value;

    expect(aki?.subarray(4)).toEqual(ski?.subarray(2));
    expect(ski?.subarray(2)).toHaveLength(20);
  });

  it("certifies the key it was given", () => {
    expect(parsed.publicKey.export({ format: "jwk" })).toEqual(
      runnerKey.publicKey.export({ format: "jwk" }),
    );
  });

  it("starts before now, so a runner whose clock is a little fast can still connect", () => {
    expect(Date.parse(parsed.validFrom)).toBeLessThan(FIXTURE_NOW.getTime());
  });
});

describe("the serial", () => {
  it("is always positive, so the stored hex matches the encoded value", () => {
    // `integer()` pads a value whose top bit is set and trims a leading zero, either of which
    // would make the hex this service stores differ from the serial a verifier reads.
    for (const first of [0x00, 0x80, 0xff]) {
      const serial = newSerial(Buffer.concat([Buffer.of(first), Buffer.alloc(15, 0xab)]));
      const issuer = authority();
      const der = issueRunnerCertificate(
        {
          subject: runnerSubject(FIXTURE_RUNNER, FIXTURE_ORGANIZATION),
          issuer: authoritySubject(FIXTURE_ORGANIZATION),
          publicKey: keypair().publicKey,
          authorityKey: issuer.privateKey,
          authorityPublicKey: issuer.publicKey,
          notBefore: new Date(FIXTURE_NOW.getTime() - 1000),
          notAfter: new Date(FIXTURE_NOW.getTime() + 1000),
          uri: runnerUri(FIXTURE_ORGANIZATION, FIXTURE_RUNNER),
        },
        serial,
      );

      const parsed = new X509Certificate(toPem("CERTIFICATE", der.der));

      expect(parsed.serialNumber.toLowerCase()).toBe(der.serial);
      expect(der.serial).toHaveLength(32);
    }
  });

  it("is different every time without being asked to be", () => {
    const serials = new Set(Array.from({ length: 50 }, () => newSerial().toString("hex")));

    expect(serials.size).toBe(50);
  });
});

describe("the fingerprint", () => {
  it("is sha256 over the DER, which is what an agent pins", () => {
    const issuer = authority();
    const parsed = new X509Certificate(issuer.pem);

    expect(issuer.row.fingerprint).toBe(parsed.fingerprint256.replace(/:/g, "").toLowerCase());
  });
});

describe("the algorithm", () => {
  it("is fixed, so a caller cannot choose a weaker one", () => {
    // There is no parameter for it anywhere in this module — the assertion is that the
    // generated pair is on the one curve and the signature verifies under SHA-256.
    const pair = generateKeyPairSync("ec", { namedCurve: CURVE });
    const issuer = authority();
    const signed = selfSignedAuthority(
      {
        subject: authoritySubject("org_x"),
        privateKey: pair.privateKey,
        publicKey: pair.publicKey,
        notBefore: new Date(FIXTURE_NOW.getTime() - 1000),
        notAfter: new Date(FIXTURE_NOW.getTime() + 1000),
      },
      newSerial(),
    );

    expect(new X509Certificate(signed.der).verify(pair.publicKey)).toBe(true);
    expect(new X509Certificate(signed.der).verify(issuer.publicKey)).toBe(false);
  });
});
