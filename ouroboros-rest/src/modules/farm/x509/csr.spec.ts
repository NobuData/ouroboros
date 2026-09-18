import { X509Certificate, generateKeyPairSync, sign } from "node:crypto";

import { publicKeyFromCsr, CSR_LABEL, InvalidCsrError, MAX_REQUEST_BYTES } from "./csr";
import { bitString, explicit, integer, oid, sequence } from "./der";
import { encodeName } from "./name";
import { toPem } from "./pem";
import {
  authority,
  certificate,
  certificationRequest,
  keypair,
  FIXTURE_ORGANIZATION,
  FIXTURE_RUNNER,
} from "../farm.fixture";

/**
 * The parser, and the decision it carries: **the runner generates its own keypair**.
 *
 * Two claims are being tested. The first is that a conforming request is read correctly, and
 * the second — the one that matters — is that **everything the request claims about itself is
 * ignored**. The second claim is the reason a hostile CSR is safe: there is no code path in
 * which a value the caller chose is consulted.
 */

describe("reading a certification request", () => {
  it("returns the key the agent asked to have certified", () => {
    const pair = keypair();

    expect(publicKeyFromCsr(certificationRequest(pair)).export({ format: "jwk" })).toEqual(
      pair.publicKey.export({ format: "jwk" }),
    );
  });

  it("returns a key and nothing else — there is no field a claim could arrive in", () => {
    // The return type *is* the design: a `KeyObject` has no subject, no requested extensions
    // and no challenge password, so "the CSR's claims are ignored" is a property of the
    // signature rather than a rule about how to use it.
    const key = publicKeyFromCsr(certificationRequest(keypair(), "CN=somebody-else"));

    expect(key.type).toBe("public");
    expect(Object.keys(key.export({ format: "jwk" })).sort()).toEqual(["crv", "kty", "x", "y"]);
  });
});

describe("what a hostile request cannot do", () => {
  const issuer = authority();

  it("cannot choose its own subject", () => {
    // The whole point. A request claiming to be another workspace's runner is signed with its
    // own correct name rather than refused, because the claim was never read.
    const pair = keypair();
    const liar = certificationRequest(pair, "some-other-workspaces-runner");
    const signed = certificate(issuer, { publicKey: publicKeyFromCsr(liar) });
    const parsed = new X509Certificate(signed.pem);

    expect(parsed.subject).toContain(`CN=${FIXTURE_RUNNER}`);
    expect(parsed.subject).toContain(`O=${FIXTURE_ORGANIZATION}`);
    expect(parsed.subject).not.toContain("some-other-workspaces-runner");
  });

  it("cannot ask for a certificate authority", () => {
    // Extensions are fixed in `certificate.ts` and are not a function of the request, so the
    // `attributes` a CSR carries reach nothing.
    const signed = certificate(issuer, {
      publicKey: publicKeyFromCsr(certificationRequest(keypair())),
    });

    expect(new X509Certificate(signed.pem).ca).toBe(false);
  });
});

describe("what it refuses", () => {
  it("refuses something that is not a PEM certificate request", () => {
    expect(() => publicKeyFromCsr("hello")).toThrow(InvalidCsrError);
    expect(() => publicKeyFromCsr(toPem("CERTIFICATE", Buffer.of(1)))).toThrow(InvalidCsrError);
  });

  it("refuses a request larger than the parser's own cap", () => {
    // The bound on the parsing work an unauthenticated caller can ask for, stated next to the
    // parser rather than left to the body parser.
    expect(() => publicKeyFromCsr("x".repeat(MAX_REQUEST_BYTES + 1))).toThrow(/too large/);
  });

  it("refuses a structure that is not well-formed DER", () => {
    expect(() => publicKeyFromCsr(toPem(CSR_LABEL, Buffer.of(0x30, 0x80, 0x00, 0x00)))).toThrow(
      /well-formed DER/,
    );
  });

  it("refuses a key on a curve this farm does not use", () => {
    // Not about safety — a P-521 certificate would verify fine — but about the fleet staying
    // one shape rather than becoming whatever each agent build happened to generate.
    const wrongCurve = generateKeyPairSync("ec", { namedCurve: "secp384r1" });

    expect(() => publicKeyFromCsr(certificationRequest(wrongCurve))).toThrow(/P-256/);
  });

  it("refuses an RSA key", () => {
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });

    expect(() => publicKeyFromCsr(certificationRequest(rsa))).toThrow(InvalidCsrError);
  });

  it("refuses a request whose self-signature does not verify", () => {
    // Proof of possession. It stops a runner enrolling somebody *else's* public key, and
    // nothing more — but a certificate over a key nobody can prove possession of would fail
    // confusingly at the first handshake instead of clearly here.
    const mine = keypair();
    const theirs = keypair();

    const info = sequence(
      integer(0),
      encodeName({ commonName: "x", organization: "y", unit: "z" }),
      theirs.publicKey.export({ type: "spki", format: "der" }),
      explicit(0, Buffer.alloc(0)),
    );

    const forged = sequence(
      info,
      sequence(oid("1.2.840.10045.4.3.2")),
      bitString(sign("sha256", info, mine.privateKey)),
    );

    expect(() => publicKeyFromCsr(toPem(CSR_LABEL, forged))).toThrow(/signature does not verify/);
  });

  it("refuses a request signed with an algorithm this CA does not accept", () => {
    const pair = keypair();
    const info = sequence(
      integer(0),
      encodeName({ commonName: "x", organization: "y", unit: "z" }),
      pair.publicKey.export({ type: "spki", format: "der" }),
      explicit(0, Buffer.alloc(0)),
    );

    // `ecdsa-with-SHA512` — a real algorithm, and not the one.
    const wrong = sequence(
      info,
      sequence(oid("1.2.840.10045.4.3.4")),
      bitString(sign("sha512", info, pair.privateKey)),
    );

    expect(() => publicKeyFromCsr(toPem(CSR_LABEL, wrong))).toThrow(/ECDSA-SHA256/);
  });

  it("says nothing about this workspace in any of its messages", () => {
    // Every message here describes the *request's* shape, which is the caller's own business.
    // `farm.errors.ts` is where the argument for that split lives.
    const messages: string[] = [];

    for (const bad of ["hello", toPem(CSR_LABEL, Buffer.of(0x30, 0x80, 0x00, 0x00))]) {
      try {
        publicKeyFromCsr(bad);
      } catch (cause) {
        messages.push((cause as Error).message);
      }
    }

    expect(messages).toHaveLength(2);
    for (const message of messages) {
      expect(message).not.toContain(FIXTURE_ORGANIZATION);
      expect(message).not.toContain("token");
    }
  });
});
