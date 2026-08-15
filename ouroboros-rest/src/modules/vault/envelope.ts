/**
 * The cryptography, and only the cryptography — AES-256-GCM, the ciphertext envelope, and
 * the additional authenticated data that binds a ciphertext to where it lives.
 *
 * Everything here is a pure function over buffers and strings. Nothing in this file knows
 * what a workspace is, reaches a database, or holds state, which is what makes the tamper
 * and AAD-binding criteria of [#222](https://github.com/NobuData/ouroboros/issues/222)
 * testable without a database and what keeps the one place key material is handled small
 * enough to read in a sitting.
 *
 * ---------------------------------------------------------------------------
 * **The envelope is a string, and it is self-describing.**
 *
 * ```
 * ouro.v1.<dek version>.<base64url nonce>.<base64url ciphertext‖tag>
 * ```
 *
 * Five dot-separated fields, and each of the first three earns its place:
 *
 *   * `ouro` — a magic prefix, so a column holding these can be told apart from a column
 *     holding something else. The one-time migration job (`vault.rotation.ts`) is the
 *     caller that needs it: it has to distinguish a value this service sealed from a value
 *     it must adopt, and guessing from the shape is how a plaintext that happens to contain
 *     dots gets treated as ciphertext.
 *   * `v1` — the *format* version, which is not the key version. It is what makes a later
 *     change to this framing — a different cipher, a different field order — detectable
 *     rather than silently misparsed. Nothing produces anything but `v1` today; the parser
 *     rejects everything else, which is the point.
 *   * the **DEK version** — which of the workspace's keys sealed this value. This is what
 *     makes a rotation additive: a value sealed under version 3 still says so after version
 *     4 becomes active, so decrypting it is a lookup rather than a guess, and the
 *     re-encrypt sweep can take as long as it takes.
 *
 * Text rather than `bytea`, because the consumers are credential columns that AD.2 and Y.1
 * will read, write, and occasionally have to look at in a psql session. base64url rather
 * than base64 so the whole envelope is URL-safe and contains no `=`-free ambiguity in the
 * middle field — the separator is `.` and the alphabet does not contain it, so parsing is a
 * `split` that cannot be fooled by the payload.
 *
 * ---------------------------------------------------------------------------
 * **The AAD is length-prefixed, and that is the whole of the swap-prevention.**
 *
 * The issue asks that a ciphertext moved between tenants, or between records, fails to
 * decrypt. AES-GCM gives that for free *if* the additional data is unambiguous — and the
 * obvious encoding is not. Joining the two identifiers with a separator makes
 * `("acme:1", "2")` and `("acme", "1:2")` produce identical bytes, so a record id chosen by
 * an attacker could be made to match another tenant's binding. {@link canonicalAad} writes
 * each part's byte length before the part, which no choice of contents can forge.
 *
 * ---------------------------------------------------------------------------
 * **Zeroization is best-effort and is documented as such.** {@link zeroize} overwrites a
 * buffer, and every caller in this module runs it in a `finally`. What it cannot do is
 * reach a `string`: JavaScript strings are immutable and the runtime may have copied one
 * anywhere. That is why {@link seal} and {@link open} speak in `Buffer`s, and why the
 * service's string-taking convenience methods are documented as the weaker guarantee.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { VaultCryptoError } from "./vault.errors";

/** The cipher. AES-256 in Galois/Counter Mode — decision **P2**, and the mockup's copy. */
export const CIPHER = "aes-256-gcm";

/** Bytes in a data-encryption key, and in the key-encryption key. 32 — AES-256. */
export const KEY_BYTES = 32;

/**
 * Bytes in a nonce. 96 bits, as the issue specifies and as GCM is defined for.
 *
 * Not a preference: 96 bits is the only length GCM uses directly rather than hashing down,
 * and it is the length every other implementation — including every KMS this will later
 * talk to — assumes. A random nonce of this size is safe for the number of messages a
 * credential vault produces by many orders of magnitude.
 */
export const NONCE_BYTES = 12;

/** Bytes in a GCM authentication tag. The full 128 bits; nothing here truncates it. */
export const TAG_BYTES = 16;

/** The envelope's magic prefix — how a sealed value is told apart from anything else. */
export const ENVELOPE_MAGIC = "ouro";

/** The envelope's *format* version. Not the key version; see this file's header. */
export const ENVELOPE_FORMAT = "v1";

/** How many dot-separated fields a well-formed envelope has. */
const ENVELOPE_FIELDS = 5;

/**
 * One sealed value's bytes — what {@link seal} produces and {@link open} consumes.
 *
 * Deliberately not a class: there is nothing to protect here, because everything in it is
 * already ciphertext. It carries no key version, because the cryptography does not need one
 * — that is the storage layer's concern, and {@link Envelope} is where it is added.
 */
export interface SealedBytes {
  /** The 96-bit nonce this value was sealed with. Unique per message, never reused. */
  readonly nonce: Buffer;
  /** The ciphertext with its 128-bit authentication tag appended. */
  readonly ciphertext: Buffer;
}

/**
 * A parsed envelope: {@link SealedBytes} plus the key version that produced them.
 *
 * Produced by {@link parseEnvelope}, and the reason a rotation can be additive — see this
 * file's header.
 */
export interface Envelope extends SealedBytes {
  /** Which of the workspace's DEK versions sealed this value. Always ≥ 1. */
  readonly version: number;
}

/**
 * Overwrite key material in place, best-effort.
 *
 * Called from a `finally` wherever this module holds a decrypted key or plaintext, so the
 * bytes stop being readable in a heap dump as soon as the operation that needed them has
 * finished. It is *best-effort* and says so: a garbage collector may already have copied
 * the buffer, and nothing here can reach a `string`.
 *
 * @param buffers - Buffers to overwrite. Undefined entries are ignored, so a caller can
 *   pass a variable that may not have been assigned before the `finally` ran.
 */
export function zeroize(...buffers: readonly (Buffer | undefined)[]): void {
  for (const buffer of buffers) {
    buffer?.fill(0);
  }
}

/**
 * The additional authenticated data binding a ciphertext to exactly one place.
 *
 * Each part is written as its byte length, a colon, and the part itself, so no combination
 * of contents can produce the bytes another combination would — see this file's header for
 * the attack the obvious encoding permits.
 *
 * The result is authenticated but **not encrypted**: GCM covers it with the tag without
 * storing it, so both sides must derive the same bytes independently. That is the property
 * that makes it swap-prevention rather than metadata — the value moved to another
 * workspace is decrypted with *that* workspace's binding, which is not the one it was
 * sealed with, and the tag fails.
 *
 * @param parts - The identifiers to bind, in a fixed order the caller must not vary.
 * @returns The canonical bytes, ready to hand to `setAAD`.
 */
export function canonicalAad(...parts: readonly string[]): Buffer {
  const encoded = parts.map((part) => {
    const bytes = Buffer.from(part, "utf8");
    return `${bytes.byteLength.toString()}:${part}`;
  });

  return Buffer.from(encoded.join(":"), "utf8");
}

/**
 * Encrypt, binding the result to `aad`.
 *
 * @param key - The 32-byte key. Not zeroized here — the caller owns its lifetime, because
 *   the caller is usually sealing several values with one key.
 * @param aad - The binding from {@link canonicalAad}. The same bytes must be supplied to
 *   {@link open} or the tag will not verify.
 * @param plaintext - What to encrypt.
 * @returns A fresh random nonce and the ciphertext with its tag appended.
 * @throws {VaultCryptoError} If the key is not {@link KEY_BYTES} bytes. A wrong-sized key is
 *   a programming error rather than bad input, and failing here rather than letting
 *   `createCipheriv` throw keeps the message free of anything Node might have quoted.
 */
export function seal(key: Buffer, aad: Buffer, plaintext: Buffer): SealedBytes {
  if (key.byteLength !== KEY_BYTES) {
    throw new VaultCryptoError(
      `vault: a data-encryption key must be ${KEY_BYTES.toString()} bytes`,
    );
  }

  // A fresh nonce per message, from the CSPRNG. Never a counter and never derived from the
  // record: reusing a nonce under one key is the failure that loses GCM's confidentiality
  // *and* its authentication, and a counter is the shape that survives a restart wrongly.
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(CIPHER, key, nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad);

  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  return { nonce, ciphertext: Buffer.concat([body, cipher.getAuthTag()]) };
}

/**
 * Decrypt, requiring that the ciphertext was sealed with exactly this key and this binding.
 *
 * @param key - The 32-byte key.
 * @param aad - The binding from {@link canonicalAad}, derived independently of the stored
 *   value. This is what makes a cross-tenant paste fail.
 * @param sealed - The nonce and the ciphertext‖tag, from {@link parseEnvelope}.
 * @returns The plaintext. The caller owns it and should {@link zeroize} it when finished.
 * @throws {VaultCryptoError} If the tag does not verify — which covers a flipped bit, a
 *   truncated value, the wrong key, and a ciphertext moved to another workspace or record,
 *   because GCM does not distinguish them. **No plaintext is returned in that case**: the
 *   tag is checked by `final()`, so a partial result is not a state this can be in.
 */
export function open(key: Buffer, aad: Buffer, sealed: SealedBytes): Buffer {
  if (key.byteLength !== KEY_BYTES) {
    throw new VaultCryptoError(
      `vault: a data-encryption key must be ${KEY_BYTES.toString()} bytes`,
    );
  }

  if (sealed.nonce.byteLength !== NONCE_BYTES || sealed.ciphertext.byteLength < TAG_BYTES) {
    throw new VaultCryptoError("vault: the ciphertext is not a well-formed sealed value");
  }

  const body = sealed.ciphertext.subarray(0, sealed.ciphertext.byteLength - TAG_BYTES);
  const tag = sealed.ciphertext.subarray(sealed.ciphertext.byteLength - TAG_BYTES);

  const decipher = createDecipheriv(CIPHER, key, sealed.nonce, { authTagLength: TAG_BYTES });
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);

  try {
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    // Node reports "Unsupported state or unable to authenticate data", which is accurate and
    // says nothing useful to a caller. Replaced rather than wrapped, so the original — which
    // has quoted a buffer in some Node versions — cannot reach a log through `cause`.
    throw new VaultCryptoError(
      "vault: the ciphertext failed authentication — it was altered, truncated, sealed with " +
        "another key, or moved from another workspace or record",
    );
  }
}

/**
 * Write an envelope as the string a consumer stores.
 *
 * @param version - Which DEK version sealed it. Must be a positive integer.
 * @param nonce - The nonce {@link seal} generated.
 * @param ciphertext - The ciphertext‖tag {@link seal} produced.
 * @returns The five-field envelope described in this file's header.
 */
export function formatEnvelope(version: number, nonce: Buffer, ciphertext: Buffer): string {
  return [
    ENVELOPE_MAGIC,
    ENVELOPE_FORMAT,
    version.toString(),
    nonce.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

/**
 * Is this string shaped like something this service sealed?
 *
 * A cheap prefix test, not a validation: it answers *should I try to open this* and nothing
 * more. The one-time migration job is the caller — it has to tell a value this service
 * already sealed from a value it must adopt, and a full parse would reject a legitimately
 * corrupt envelope as "not ours" and quietly re-encrypt it as if it were plaintext.
 *
 * @param value - A stored secret, of unknown provenance.
 * @returns `true` when it carries this module's magic and format version.
 */
export function isEnvelope(value: string): boolean {
  return value.startsWith(`${ENVELOPE_MAGIC}.${ENVELOPE_FORMAT}.`);
}

/**
 * Read a stored envelope back into its parts.
 *
 * Strict on every field, because the alternative is to guess: a value with four fields, a
 * version that is not a number, or base64 that decodes to the wrong length is not a value
 * this service produced, and attempting to decrypt it would report an authentication
 * failure — which would send whoever reads the log looking for tampering rather than for
 * the column that got truncated.
 *
 * @param value - The stored string.
 * @returns The version, nonce and ciphertext.
 * @throws {VaultCryptoError} If it is not a well-formed envelope. The message names no part
 *   of the value.
 */
export function parseEnvelope(value: string): Envelope {
  const fields = value.split(".");

  if (fields.length !== ENVELOPE_FIELDS) {
    throw new VaultCryptoError(
      `vault: a sealed value has ${ENVELOPE_FIELDS.toString()} dot-separated fields`,
    );
  }

  const [magic, format, version, nonce, ciphertext] = fields as [
    string,
    string,
    string,
    string,
    string,
  ];

  if (magic !== ENVELOPE_MAGIC || format !== ENVELOPE_FORMAT) {
    throw new VaultCryptoError(
      `vault: a sealed value opens with ${ENVELOPE_MAGIC}.${ENVELOPE_FORMAT}`,
    );
  }

  // Anchored digits rather than Number(): "3abc" and " 3" both parse to something plausible,
  // and a version that is plausible-but-wrong looks up a key that exists and fails
  // authentication, which is the least diagnosable outcome available.
  if (!/^\d+$/.test(version) || Number(version) < 1) {
    throw new VaultCryptoError("vault: a sealed value names its key version as a number from 1");
  }

  const decodedNonce = Buffer.from(nonce, "base64url");
  const decodedCiphertext = Buffer.from(ciphertext, "base64url");

  if (decodedNonce.byteLength !== NONCE_BYTES) {
    throw new VaultCryptoError(
      `vault: a sealed value carries a ${NONCE_BYTES.toString()}-byte nonce`,
    );
  }

  // Shorter than a tag means there is no ciphertext at all, only part of one.
  if (decodedCiphertext.byteLength < TAG_BYTES) {
    throw new VaultCryptoError("vault: a sealed value is shorter than its authentication tag");
  }

  return { version: Number(version), nonce: decodedNonce, ciphertext: decodedCiphertext };
}
