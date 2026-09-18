/**
 * The certificate factory — what the farm CA actually signs.
 *
 * AH.2 ([#250](https://github.com/NobuData/ouroboros/issues/250)). Two shapes come out of
 * here and there will never be a third: a workspace's **self-signed CA**, and a **runner's
 * client certificate** issued by it. They are separate functions rather than one function
 * with a flag, because the flag would be `isCa` and it would be the single most dangerous
 * boolean in this service — a leaf certificate issued with `cA: TRUE` is a runner that can
 * mint runners.
 *
 * ```
 * P-256 keypair ──▶ selfSignedAuthority()  ──▶ the CA certificate  (cA: TRUE, pathLen 0)
 *                                    │             key sealed by AD.1 (#222), never returned
 *                                    ▼
 * runner CSR ────▶ issueRunnerCertificate() ──▶ CN=<runner id>, O=<workspace>
 *                                                 clientAuth only · cA: FALSE
 * ```
 *
 * ---------------------------------------------------------------------------
 * **ECDSA on P-256, and nothing configurable.** An algorithm choice a caller can pass in is
 * an algorithm choice that can be got wrong per call site, and the set of callers is two.
 * P-256 is what every TLS stack this farm has to interoperate with supports natively — Go's
 * `crypto/tls` on the agent side, Node's on the gateway's, and OpenSSL wherever a proxy
 * terminates in between — and its signatures are a third the size of RSA-2048's, which
 * matters for a handshake a runner repeats on every reconnect.
 *
 * **The leaf's key usage is `digitalSignature` and its extended usage is `clientAuth`,
 * both of them alone.** A runner certificate is an identity for a TLS client handshake and
 * is not a thing for signing artifacts, encrypting to, or serving TLS with. Naming only what
 * is needed is what makes a stolen runner key useless for anything but impersonating that
 * one runner — which revocation then answers.
 *
 * **`pathLenConstraint: 0` on the CA.** The farm CA signs end entities and nothing else. A
 * sub-CA is not a capability anybody asked for, and a path length that permitted one would
 * be an unused capability in the most sensitive certificate a workspace has.
 *
 * ---------------------------------------------------------------------------
 * **What this file does not decide.** It does not choose a subject — `name.ts` composes
 * those from rows, never from a request. It does not choose a validity window —
 * `farm.policy.ts` does, in one place, so *how long is a runner certificate good for* has
 * one answer. And it never sees a sealed key: it takes a `KeyObject` the CA service
 * unwrapped and will zeroize, which is why nothing here caches, copies or exports one.
 */

import { createHash, createPublicKey, randomBytes, sign, type KeyObject } from "node:crypto";

import {
  ascii,
  bitString,
  boolean,
  explicit,
  implicitPrimitive,
  integer,
  octetString,
  oid,
  sequence,
  time,
  TAG,
} from "./der";
import { encodeName, type DistinguishedName } from "./name";
import { children, read } from "./reader";

/** `ecdsa-with-SHA256` — the one signature algorithm this CA produces. */
const ECDSA_WITH_SHA256 = "1.2.840.10045.4.3.2";

/** `id-ce-subjectKeyIdentifier`. */
const SUBJECT_KEY_IDENTIFIER = "2.5.29.14";
/** `id-ce-keyUsage`. */
const KEY_USAGE = "2.5.29.15";
/** `id-ce-subjectAltName`. */
const SUBJECT_ALT_NAME = "2.5.29.17";
/** `id-ce-basicConstraints`. */
const BASIC_CONSTRAINTS = "2.5.29.19";
/** `id-ce-authorityKeyIdentifier`. */
const AUTHORITY_KEY_IDENTIFIER = "2.5.29.35";
/** `id-ce-extKeyUsage`. */
const EXTENDED_KEY_USAGE = "2.5.29.37";
/** `id-kp-clientAuth` — the only extended usage a runner certificate carries. */
const CLIENT_AUTH = "1.3.6.1.5.5.7.3.2";

/** `version: v3`, which is `2`. Explicitly tagged `[0]` in the ASN.1 module. */
const VERSION_V3 = 2;

/** The `GeneralName` alternative a URI takes — `uniformResourceIdentifier [6]`. */
const URI_GENERAL_NAME = 6;

/** The `AuthorityKeyIdentifier` field a key id takes — `keyIdentifier [0] IMPLICIT`. */
const AKI_KEY_IDENTIFIER = 0;

/** `digitalSignature`, bit 0 — a leaf's only key usage. */
const USE_DIGITAL_SIGNATURE = 0b1000_0000;
/** `keyCertSign` (bit 5) and `cRLSign` (bit 6) — the CA's two, and only the CA's. */
const USE_CERT_AND_CRL_SIGN = 0b0000_0110;
/** The unused low bits of the one-byte `keyUsage` bit string, for each of the two sets. */
const UNUSED_BITS_LEAF = 7;
const UNUSED_BITS_AUTHORITY = 1;

/** How many random bytes a serial number is. 128 bits, well inside RFC 5280's 20-octet cap. */
const SERIAL_BYTES = 16;

/** The curve every key this module signs with or for is on. */
export const CURVE = "prime256v1";

/** The named curve, as a JWK-style label, for the one place a key is checked rather than used. */
export const CURVE_JWK = "P-256";

/**
 * A certificate, in the two forms every consumer of this module wants it in.
 *
 * The DER is what gets hashed for a fingerprint and what `crypto.X509Certificate` parses;
 * the PEM is what goes in a column and on a runner's disk. Returning both is what stops each
 * caller re-deriving one from the other and disagreeing about the encoding.
 */
export interface IssuedCertificate {
  /** The signed bytes. */
  readonly der: Buffer;
  /** The serial, lowercase hex, as it is stored and as a revocation names it. */
  readonly serial: string;
  /** `sha256` over the DER, lowercase hex — what a CA pin and a revocation check compare. */
  readonly fingerprint: string;
  /** Not valid before this instant. */
  readonly notBefore: Date;
  /** Not valid after this instant. */
  readonly notAfter: Date;
}

/** What {@link issueRunnerCertificate} needs to know that it cannot work out for itself. */
export interface RunnerCertificateRequest {
  /** The subject, composed by `name.ts` from rows — never from the CSR. */
  readonly subject: DistinguishedName;
  /** The CA's own subject, which becomes this certificate's issuer. */
  readonly issuer: DistinguishedName;
  /** The runner's public key, as it arrived in its CSR and was re-derived by `csr.ts`. */
  readonly publicKey: KeyObject;
  /** The CA's private key. Unwrapped by the caller for this call and zeroized after it. */
  readonly authorityKey: KeyObject;
  /** The CA's public key, for the authority key identifier. */
  readonly authorityPublicKey: KeyObject;
  /** The start of the validity window. */
  readonly notBefore: Date;
  /** The end of it. */
  readonly notAfter: Date;
  /** The URI that names this runner in a `SubjectAltName` — see {@link runnerUri}. */
  readonly uri: string;
}

/**
 * The URN a runner certificate carries as its one subject alternative name.
 *
 * A `CN` is not a machine-readable identifier — RFC 6125 has said so for a decade, and a
 * verifier that reads one is a verifier doing string surgery on a name. The SAN is where the
 * runner's identity is stated in a form the gateway can compare exactly, and a URN rather
 * than a DNS name because a runner has no hostname this control plane knows or could
 * resolve.
 *
 * @param organizationId - The workspace.
 * @param runnerId - The runner row.
 * @returns `urn:ouroboros:runner:<workspace>:<runner>`.
 */
export function runnerUri(organizationId: string, runnerId: string): string {
  return `urn:ouroboros:runner:${organizationId}:${runnerId}`;
}

/**
 * Sign a runner's client certificate.
 *
 * @param request - The subject, the issuer, both keys and the window.
 * @param serial - The serial number's bytes. Passed in rather than generated here so the
 *   caller can record it before the certificate exists — see `farm.ca.ts` on why the row is
 *   written first.
 * @returns The certificate.
 */
export function issueRunnerCertificate(
  request: RunnerCertificateRequest,
  serial: Buffer,
): IssuedCertificate {
  const extensions = [
    extension(BASIC_CONSTRAINTS, true, sequence()),
    extension(KEY_USAGE, true, bitString(Buffer.of(USE_DIGITAL_SIGNATURE), UNUSED_BITS_LEAF)),
    extension(EXTENDED_KEY_USAGE, false, sequence(oid(CLIENT_AUTH))),
    extension(SUBJECT_KEY_IDENTIFIER, false, octetString(keyIdentifier(request.publicKey))),
    extension(
      AUTHORITY_KEY_IDENTIFIER,
      false,
      sequence(implicitPrimitive(AKI_KEY_IDENTIFIER, keyIdentifier(request.authorityPublicKey))),
    ),
    // `GeneralNames` is a SEQUENCE of `GeneralName`, and `uniformResourceIdentifier` is an
    // IA5String tagged `[6] IMPLICIT` — implicit, so the string's own tag is replaced rather
    // than wrapped, which is why the URI's bytes go in bare.
    extension(
      SUBJECT_ALT_NAME,
      false,
      sequence(implicitPrimitive(URI_GENERAL_NAME, ascii(request.uri))),
    ),
  ];

  return signCertificate({
    serial,
    issuer: request.issuer,
    subject: request.subject,
    publicKey: request.publicKey,
    notBefore: request.notBefore,
    notAfter: request.notAfter,
    extensions,
    signingKey: request.authorityKey,
  });
}

/** What {@link selfSignedAuthority} needs. */
export interface AuthorityCertificateRequest {
  /** The CA's subject, which is also its issuer. */
  readonly subject: DistinguishedName;
  /** Its keypair — the private half is unwrapped for this call and zeroized after it. */
  readonly privateKey: KeyObject;
  /** The public half. */
  readonly publicKey: KeyObject;
  /** The start of the validity window. */
  readonly notBefore: Date;
  /** The end of it. */
  readonly notAfter: Date;
}

/**
 * Sign a workspace's farm CA certificate, with its own key.
 *
 * @param request - The subject, the keypair and the window.
 * @param serial - The serial number's bytes.
 * @returns The certificate. Public, pinned by every runner in the workspace, and the one
 *   thing about the CA that is ever returned by an API.
 */
export function selfSignedAuthority(
  request: AuthorityCertificateRequest,
  serial: Buffer,
): IssuedCertificate {
  const identifier = keyIdentifier(request.publicKey);

  const extensions = [
    // `cA: TRUE`, and a path length of zero — see this file's header. The `TRUE` is written
    // explicitly because DER omits a `DEFAULT FALSE` field: a basic-constraints value that
    // encoded `cA` as absent would be a CA certificate that says it is not one.
    extension(BASIC_CONSTRAINTS, true, sequence(boolean(true), integer(0))),
    extension(KEY_USAGE, true, bitString(Buffer.of(USE_CERT_AND_CRL_SIGN), UNUSED_BITS_AUTHORITY)),
    extension(SUBJECT_KEY_IDENTIFIER, false, octetString(identifier)),
    extension(
      AUTHORITY_KEY_IDENTIFIER,
      false,
      sequence(implicitPrimitive(AKI_KEY_IDENTIFIER, identifier)),
    ),
  ];

  return signCertificate({
    serial,
    issuer: request.subject,
    subject: request.subject,
    publicKey: request.publicKey,
    notBefore: request.notBefore,
    notAfter: request.notAfter,
    extensions,
    signingKey: request.privateKey,
  });
}

/** The fully-resolved inputs of one signature — what the two public functions reduce to. */
interface SignableCertificate {
  readonly serial: Buffer;
  readonly issuer: DistinguishedName;
  readonly subject: DistinguishedName;
  readonly publicKey: KeyObject;
  readonly notBefore: Date;
  readonly notAfter: Date;
  readonly extensions: readonly Buffer[];
  readonly signingKey: KeyObject;
}

/**
 * Assemble a `TBSCertificate`, sign it, and wrap both in a `Certificate`.
 *
 * The one place a signature is produced. `sign(null, …)` with a P-256 key uses the digest
 * named by the algorithm identifier — SHA-256 — and produces the DER `ECDSA-Sig-Value`
 * X.509 expects, which is why the signature goes into the bit string unmodified.
 *
 * @param certificate - Everything that is signed, plus the key that signs it.
 * @returns The certificate, with its serial and fingerprint already derived.
 */
function signCertificate(certificate: SignableCertificate): IssuedCertificate {
  const algorithm = sequence(oid(ECDSA_WITH_SHA256));

  const tbs = sequence(
    explicit(0, integer(VERSION_V3)),
    integer(certificate.serial),
    algorithm,
    encodeName(certificate.issuer),
    sequence(time(certificate.notBefore), time(certificate.notAfter)),
    encodeName(certificate.subject),
    spki(certificate.publicKey),
    explicit(3, sequence(...certificate.extensions)),
  );

  const signature = sign("sha256", tbs, certificate.signingKey);
  const der = sequence(tbs, algorithm, bitString(signature));

  return {
    der,
    serial: certificate.serial.toString("hex"),
    fingerprint: createHash("sha256").update(der).digest("hex"),
    notBefore: certificate.notBefore,
    notAfter: certificate.notAfter,
  };
}

/**
 * A fresh serial number.
 *
 * Random rather than sequential, and 128 bits of it. A sequential serial tells anybody
 * holding two certificates how many a workspace has issued between them, and — more to the
 * point — a counter is state two replicas would have to agree about. Random needs no
 * agreement and the uniqueness constraint in the database is what would catch a collision
 * that will not happen.
 *
 * @param bytes - Where the randomness comes from. Injected only so a test can assert the
 *   encoding of a serial it chose; production passes nothing.
 * @returns The serial's bytes, always positive: the high bit is cleared, so `integer()` does
 *   not have to pad and the stored hex is the same length every time.
 */
export function newSerial(bytes: Buffer = randomBytes(SERIAL_BYTES)): Buffer {
  const serial = Buffer.from(bytes);
  serial[0] = (serial[0] ?? 0) & 0x7f;
  // A leading zero byte would be trimmed by `integer()` and the stored hex would then not
  // match the encoded serial. Forcing the top nibble keeps the two identical.
  if (serial[0] === 0x00) serial[0] = 0x01;

  return serial;
}

/**
 * A public key as a DER `SubjectPublicKeyInfo`.
 *
 * @param key - The key.
 * @returns Its SPKI bytes — Node's own encoding, which is already exactly the field.
 */
function spki(key: KeyObject): Buffer {
  return key.export({ type: "spki", format: "der" });
}

/**
 * RFC 5280's first method for a key identifier: SHA-1 over the `subjectPublicKey` bit
 * string's contents.
 *
 * SHA-1 is the standard's choice and is not a security claim: a key identifier is a hint for
 * chain building, and RFC 5280 § 4.2.1.2 says as much. Nothing in this service authorizes on
 * one, and `reader.ts` is what makes the walk to the bit string a bounds-checked one.
 *
 * @param key - The key. A private one is reduced to its public half first; the bytes walked
 *   are in either case Node's own canonical export rather than anything off the wire.
 * @returns The 20-byte identifier.
 * @throws {Error} If the export is not a `SubjectPublicKeyInfo`, which would be a bug in the
 *   platform rather than an input.
 */
function keyIdentifier(key: KeyObject): Buffer {
  const der = spki(key.type === "private" ? createPublicKey(key) : key);

  // SubjectPublicKeyInfo ::= SEQUENCE { algorithm AlgorithmIdentifier, subjectPublicKey BIT STRING }
  const [, publicKey] = children(der, read(der, 0));

  if (!publicKey || publicKey.tag !== TAG.BIT_STRING) {
    throw new Error("A SubjectPublicKeyInfo ends in a BIT STRING.");
  }

  // Past the unused-bit count, which is zero for every key type this handles.
  const bits = der.subarray(publicKey.contentAt + 1, publicKey.end);

  return createHash("sha1").update(bits).digest();
}

/**
 * One `Extension`.
 *
 * @param id - The extension's object identifier.
 * @param critical - Whether a verifier that does not understand it must refuse the
 *   certificate. Written only when `true`, because `DEFAULT FALSE` fields are omitted in DER
 *   — and an encoder that wrote `FALSE` explicitly would produce a certificate some strict
 *   parsers reject.
 * @param value - The extension's own value, already encoded. It is wrapped in an
 *   `OCTET STRING`, which is what makes an unknown extension skippable.
 * @returns The encoded extension.
 */
function extension(id: string, critical: boolean, value: Buffer): Buffer {
  return sequence(oid(id), ...(critical ? [boolean(true)] : []), octetString(value));
}
