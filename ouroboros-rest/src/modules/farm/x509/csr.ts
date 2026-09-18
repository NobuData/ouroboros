/**
 * The certificate signing request — and the decision, made here because the issue asked for
 * it to be made: **the runner generates its own keypair and sends a CSR.**
 *
 * AH.2 ([#250](https://github.com/NobuData/ouroboros/issues/250)) leaves *server-side
 * keypair versus agent CSR* open and says to decide it in-issue and write the decision down.
 * This is where it is written down.
 *
 * ---------------------------------------------------------------------------
 * **The decision, and what it costs.**
 *
 * The alternative is the simpler one, and the issue's own sequence diagram draws it: the
 * control plane generates a keypair, signs a certificate over it, and returns
 * `{runner_id, cert, key}`. One request, no ASN.1 parsing on the server, and an agent that
 * writes two files and is done.
 *
 * It is rejected because of where the private key would have been. In that design a runner's
 * private key exists — briefly — in this service's memory, in the HTTP response body, in
 * whatever buffers the TLS stack used, and in any reverse proxy between the two. Every one of
 * those is a place it can be logged, cored, or read by an operator of the control plane,
 * which is precisely the posture decision **B3** was written against: *the secret sits on a
 * machine outside the operator's control, and if it is copied, the copy is indistinguishable
 * from the original*. A design in which the control plane has never held the key at all does
 * not have that failure mode to mitigate.
 *
 * What it costs is this file: the enrollment endpoint has to read a structure an
 * unauthenticated caller composed. That cost is bounded by delegating everything that is not
 * a structural walk — `reader.ts` finds the `SubjectPublicKeyInfo` and nothing else, and the
 * key itself is parsed by `crypto.createPublicKey` and the self-signature verified by
 * `crypto.verify`. Both are the platform's C, not this module's TypeScript.
 *
 * It also costs the agent a keypair generation, which in Go is three lines, and it means a
 * renewal is a second CSR rather than a second key handed down. `SECURITY_MODEL.md`'s
 * farm-CA section states the consequence a reader actually needs: **no runner private key
 * has ever existed inside Ouroboros**, so there is no backup, no log and no database column
 * from which one could be recovered — including by us.
 *
 * ---------------------------------------------------------------------------
 * **What is read out of a request, and what is ignored.**
 *
 * ```
 * CertificationRequest ::= SEQUENCE {
 *   certificationRequestInfo  CertificationRequestInfo,   ── signed over
 *   signatureAlgorithm        AlgorithmIdentifier,        ── checked: ECDSA-SHA256
 *   signature                 BIT STRING }                ── verified
 *
 * CertificationRequestInfo ::= SEQUENCE {
 *   version        INTEGER,            ── ignored
 *   subject        Name,               ── IGNORED — see below
 *   subjectPKInfo  SubjectPublicKeyInfo,   ── THE POINT
 *   attributes     [0] Attributes }    ── ignored
 * ```
 *
 * **The subject is ignored, deliberately and completely.** A runner does not get to say who
 * it is; `name.ts` composes the subject from the runner row this service created and the
 * workspace the enrollment token was scoped to. A CSR claiming to be another workspace's
 * runner is signed with its own correct name rather than refused, because the claim was
 * never read. The same goes for the requested extensions in `attributes` — a CSR asking for
 * `cA: TRUE` gets a leaf certificate, because the extension set is fixed in `certificate.ts`
 * and is not a function of the request.
 *
 * **The self-signature is verified even though it proves less than it looks like it does.**
 * It proves the sender holds the private key for the public key in the request, which stops
 * a runner from enrolling somebody else's public key and does not stop anything else — a
 * stolen enrollment token still enrols. It is checked because a certificate issued over a
 * key nobody can prove possession of is a certificate that can never be used and would fail
 * confusingly at the first handshake instead of clearly here.
 */

import { createPublicKey, verify, type KeyObject } from "node:crypto";

import { fromPem } from "./pem";
import { at, bytesOf, children, read, DerFormatError, type Element } from "./reader";
import { CURVE_JWK } from "./certificate";

/** The PEM label a certification request is carried in. */
export const CSR_LABEL = "CERTIFICATE REQUEST";

/**
 * The largest request this will look at, in bytes.
 *
 * A P-256 request is around 250 bytes and this allows sixteen kilobytes, which is room for a
 * long subject and an RSA-4096 key that would then be refused on its curve. The cap is here
 * rather than left to the body parser because it is the bound on the parsing work an
 * unauthenticated caller can ask for, and it should be stated next to the parser.
 */
export const MAX_REQUEST_BYTES = 16 * 1024;

/** What a request that cannot be used raises. One class, because callers answer it one way. */
export class InvalidCsrError extends Error {}

/**
 * Read a certification request, verify it proves possession, and return only its key.
 *
 * **The return type is the whole design.** A `KeyObject` and nothing else: there is no field
 * on it through which a subject, a requested extension or a challenge password could reach a
 * caller, so *the CSR's claims are ignored* is a property of the signature rather than a rule
 * about how to use it.
 *
 * @param pem - The request, PEM-encoded, as it arrived in the enrollment body.
 * @returns The public key to certify.
 * @throws {InvalidCsrError} If the PEM is absent or malformed, the structure is not a
 *   certification request, the key is not on {@link CURVE_JWK}, or the self-signature does
 *   not verify. The message is a sentence for a person and never echoes the input.
 */
export function publicKeyFromCsr(pem: string): KeyObject {
  if (pem.length > MAX_REQUEST_BYTES) {
    throw new InvalidCsrError("The certificate request is too large.");
  }

  const der = decode(pem);

  try {
    const request = children(der, read(der, 0));
    const info = at(request, 0, "certification request info");
    const algorithm = at(request, 1, "signature algorithm");
    const signature = at(request, 2, "signature");

    const key = subjectPublicKey(der, info);

    assertSignature(der, info, algorithm, signature, key);

    return key;
  } catch (cause) {
    if (cause instanceof InvalidCsrError) throw cause;
    if (cause instanceof DerFormatError) {
      throw new InvalidCsrError("The certificate request is not well-formed DER.");
    }

    throw new InvalidCsrError("The certificate request could not be read.");
  }
}

/**
 * The PEM body, as bytes.
 *
 * @param pem - The text.
 * @returns The DER.
 * @throws {InvalidCsrError} If there is no `CERTIFICATE REQUEST` block.
 */
function decode(pem: string): Buffer {
  try {
    return fromPem(CSR_LABEL, pem);
  } catch {
    throw new InvalidCsrError("Expected a PEM-encoded CERTIFICATE REQUEST.");
  }
}

/**
 * The key a request is asking to have certified.
 *
 * @param der - The whole request.
 * @param info - Its `CertificationRequestInfo`.
 * @returns The key, re-derived by the platform from the request's own `SubjectPublicKeyInfo`
 *   bytes. Everything after this point uses Node's canonical encoding of it rather than the
 *   caller's.
 * @throws {InvalidCsrError} If the key is not an EC key on the farm's curve.
 */
function subjectPublicKey(der: Buffer, info: Element): KeyObject {
  const spki = at(children(der, info), 2, "subject public key info");

  let key: KeyObject;
  try {
    key = createPublicKey({ key: bytesOf(der, spki), format: "der", type: "spki" });
  } catch {
    throw new InvalidCsrError("The certificate request does not carry a usable public key.");
  }

  // The curve is checked rather than accepted, and by asking the key what it is rather than
  // by reading an object identifier out of the bytes. An RSA or a P-521 key would produce a
  // certificate this farm's own gateway could still verify — so the refusal is not about
  // safety, it is about the fleet staying one shape rather than becoming whatever each agent
  // build happened to generate.
  const jwk = key.export({ format: "jwk" });
  if (jwk.kty !== "EC" || jwk.crv !== CURVE_JWK) {
    throw new InvalidCsrError(`A runner key is an EC key on ${CURVE_JWK}.`);
  }

  return key;
}

/**
 * Verify that whoever composed the request holds the key it names.
 *
 * @param der - The whole request.
 * @param info - The signed structure.
 * @param algorithm - The declared signature algorithm.
 * @param signature - The signature's `BIT STRING`.
 * @param key - The public key from the request.
 * @throws {InvalidCsrError} If the algorithm is not the farm's, or the signature does not
 *   verify over the request info exactly as it arrived.
 */
function assertSignature(
  der: Buffer,
  info: Element,
  algorithm: Element,
  signature: Element,
  key: KeyObject,
): void {
  // `ecdsa-with-SHA256`, encoded as a one-element AlgorithmIdentifier. Compared as bytes
  // rather than decoded: there is exactly one acceptable value, and a byte comparison cannot
  // be fooled by a parameter field an OID comparison would have skipped.
  const expected = Buffer.from("300a06082a8648ce3d040302", "hex");
  if (!der.subarray(algorithm.start, algorithm.end).equals(expected)) {
    throw new InvalidCsrError("A runner request is signed with ECDSA-SHA256.");
  }

  // Past the unused-bit count. A signature is whole bytes, so it is zero.
  const bytes = der.subarray(signature.contentAt + 1, signature.end);
  const signed = der.subarray(info.start, info.end);

  let ok: boolean;
  try {
    ok = verify("sha256", signed, key, bytes);
  } catch {
    ok = false;
  }

  if (!ok) {
    throw new InvalidCsrError("The certificate request's signature does not verify.");
  }
}
