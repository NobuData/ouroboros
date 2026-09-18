/**
 * DER, as much of it as a certificate authority needs — the encoder every other file in
 * `x509/` is written in terms of.
 *
 * AH.2 ([#250](https://github.com/NobuData/ouroboros/issues/250)). The issue's technical
 * stack says *`node:crypto` X.509 (or smallstep)*, and `node:crypto` can do three of the
 * four things a CA needs: it generates keypairs, it exports a public key as a DER
 * `SubjectPublicKeyInfo`, and it signs and verifies. The fourth — **assembling a
 * certificate** — it does not do at all. `crypto.X509Certificate` parses; nothing in Node
 * constructs one.
 *
 * So the choice was a dependency or this file, and this file won for a reason narrower than
 * taste: the code that signs with a workspace's CA key is the code a reviewer has to be able
 * to read end to end. A library would be a few hundred kilobytes of ASN.1 machinery in the
 * one path where *what exactly got signed* is the question, and it would be a supply-chain
 * edge on the private key this service works hardest to keep sealed. What a CA actually
 * emits is a fixed shape — nine fields and six extensions — and encoding it is about two
 * hundred lines of type-length-value.
 *
 * **What this is not.** It is an encoder, not a codec, and deliberately asymmetric: writing
 * DER is a closed set of shapes this service chooses, and reading it is an open set an
 * attacker chooses. The one thing that has to be *read* is a PKCS#10 request from a runner,
 * and `csr.ts` does that against `crypto.X509Certificate`'s sibling parser rather than
 * against a hand-written one — see that file's header. Nothing here parses.
 *
 * ---------------------------------------------------------------------------
 * **Distinguished encoding, not merely basic.** DER is BER with the choices removed, and two
 * of those removals are load-bearing here rather than pedantic:
 *
 *   * **Lengths are minimal.** 127 bytes or fewer is one byte; anything longer is a leading
 *     byte counting the length's own bytes, with no leading zero. A non-minimal length is
 *     still readable by most parsers, which is exactly why it has to be got right here — a
 *     certificate that some verifiers accept and others reject is the worst failure this
 *     module could ship.
 *   * **Integers are signed, minimal, and big-endian.** A serial number whose top bit is set
 *     needs a leading `0x00` or it reads as negative; a serial with a redundant leading
 *     `0x00` is malformed. {@link integer} does both, which is why serial numbers are built
 *     through it rather than concatenated.
 *
 * `SET OF` ordering — DER sorts a set's members by their encoding — is the third such rule
 * and the one place this file sidesteps rather than implements: every `SET` a certificate
 * needs here holds exactly one element, and {@link set} says so in its own documentation
 * rather than sorting a list that is never longer than one.
 */

/** ASN.1 tag numbers, in the universal class, for the types a certificate is built from. */
export const TAG = {
  /** `BOOLEAN` — `basicConstraints`' `cA` flag, and nothing else here. */
  BOOLEAN: 0x01,
  /** `INTEGER` — the version, the serial, `basicConstraints`' path length. */
  INTEGER: 0x02,
  /** `BIT STRING` — the signature, the subject public key, `keyUsage`. */
  BIT_STRING: 0x03,
  /** `OCTET STRING` — key identifiers, and the wrapper every extension value sits in. */
  OCTET_STRING: 0x04,
  /** `NULL` — the parameters of an RSA signature algorithm. Absent for ECDSA. */
  NULL: 0x05,
  /** `OBJECT IDENTIFIER` — algorithms, attribute types, extension ids. */
  OID: 0x06,
  /** `UTF8String` — every string in a name this service composes. */
  UTF8_STRING: 0x0c,
  /** `SEQUENCE` — the workhorse. */
  SEQUENCE: 0x30,
  /** `SET` — the one-element wrapper around each attribute of a name. */
  SET: 0x31,
  /** `PrintableString` — read from a parsed name, never written by this service. */
  PRINTABLE_STRING: 0x13,
  /** `IA5String` — the SAN's URI form. */
  IA5_STRING: 0x16,
  /** `UTCTime` — validity before 2050. */
  UTC_TIME: 0x17,
  /** `GeneralizedTime` — validity from 2050 on. */
  GENERALIZED_TIME: 0x18,
} as const;

/** The constructed bit, and the context-specific class — together, `[n]` in an ASN.1 module. */
const CONTEXT_CONSTRUCTED = 0xa0;

/** The context-specific class without the constructed bit — `[n] IMPLICIT` over a primitive. */
const CONTEXT_PRIMITIVE = 0x80;

/** Above this, a length needs its own length byte. */
const SHORT_FORM_MAX = 0x7f;

/** The bit that marks a long-form length, and the mask that carries the byte count. */
const LONG_FORM_FLAG = 0x80;

/** One byte, as a mask — the magic number of a big-endian encoder. */
const BYTE_MASK = 0xff;

/**
 * Encode one type-length-value triple.
 *
 * The primitive every other function here is one line on top of.
 *
 * @param tag - The identifier octet — one of {@link TAG}, or a context-specific tag already
 *   combined with its class and constructed bits.
 * @param content - The value's bytes, already encoded.
 * @returns Tag, minimal-form length, content.
 */
export function tlv(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.of(tag), encodeLength(content.length), content]);
}

/**
 * DER's minimal length encoding.
 *
 * @param length - How many content bytes follow. Never negative — every caller passes a
 *   `Buffer`'s own length.
 * @returns One byte below 128; otherwise a count byte and the big-endian length with no
 *   leading zero.
 */
function encodeLength(length: number): Buffer {
  if (length <= SHORT_FORM_MAX) return Buffer.of(length);

  const bytes: number[] = [];
  for (let remaining = length; remaining > 0; remaining = Math.floor(remaining / (BYTE_MASK + 1))) {
    bytes.unshift(remaining & BYTE_MASK);
  }

  return Buffer.concat([Buffer.of(LONG_FORM_FLAG | bytes.length), Buffer.from(bytes)]);
}

/**
 * A `SEQUENCE` of already-encoded members.
 *
 * @param members - The members, in the order the ASN.1 module declares them. DER does not
 *   reorder a sequence, so the order here is the order on the wire.
 * @returns The encoded sequence.
 */
export function sequence(...members: Buffer[]): Buffer {
  return tlv(TAG.SEQUENCE, Buffer.concat(members));
}

/**
 * A `SET` of exactly one member.
 *
 * DER requires a `SET OF`'s members to be sorted by their own encoding, and this function
 * does not sort — because the only sets a certificate needs here are the single-element
 * `RelativeDistinguishedName`s of a name, where sorting is a no-op. A caller with two
 * members would be composing a multi-valued RDN, which this service never does and which
 * `name.ts` has no way to express.
 *
 * @param member - The one member.
 * @returns The encoded set.
 */
export function set(member: Buffer): Buffer {
  return tlv(TAG.SET, member);
}

/**
 * A signed, minimal, big-endian `INTEGER`.
 *
 * @param value - A non-negative integer, or its big-endian bytes for a value too large for a
 *   JavaScript number — a 128-bit serial is the case that matters.
 * @returns The encoded integer, with a leading `0x00` where the high bit would otherwise
 *   make it negative and with redundant leading zeroes removed.
 * @throws {RangeError} If a number is negative or not an integer. A negative serial is not a
 *   thing this service has any way to mean, so it is refused rather than encoded.
 */
export function integer(value: number | Buffer): Buffer {
  const magnitude = typeof value === "number" ? numberBytes(value) : value;

  let start = 0;
  while (start < magnitude.length - 1 && magnitude[start] === 0x00) start += 1;

  const trimmed = magnitude.subarray(start);
  const needsPad = (trimmed[0] ?? 0) >= LONG_FORM_FLAG;

  return tlv(TAG.INTEGER, needsPad ? Buffer.concat([Buffer.of(0x00), trimmed]) : trimmed);
}

/**
 * A non-negative safe integer as big-endian bytes.
 *
 * @param value - The number.
 * @returns At least one byte — zero encodes as `00` rather than as nothing.
 * @throws {RangeError} If the value is negative or not an integer.
 */
function numberBytes(value: number): Buffer {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("A DER integer here is a non-negative safe integer.");
  }

  const bytes: number[] = [];
  let remaining = value;
  do {
    bytes.unshift(remaining & BYTE_MASK);
    remaining = Math.floor(remaining / (BYTE_MASK + 1));
  } while (remaining > 0);

  return Buffer.from(bytes);
}

/**
 * A `BOOLEAN`.
 *
 * DER fixes `true` at `0xFF` — BER allows any non-zero byte, and this is one of the choices
 * DER removes.
 *
 * @param value - The flag.
 * @returns The encoded boolean.
 */
export function boolean(value: boolean): Buffer {
  return tlv(TAG.BOOLEAN, Buffer.of(value ? BYTE_MASK : 0x00));
}

/**
 * A `BIT STRING` over whole bytes.
 *
 * @param content - The bytes.
 * @param unusedBits - How many of the final byte's low bits are padding. Zero for a
 *   signature or a public key; non-zero only for `keyUsage`, which is a bit set rather than
 *   a byte string.
 * @returns The encoded bit string, unused-bit count first.
 */
export function bitString(content: Buffer, unusedBits = 0): Buffer {
  return tlv(TAG.BIT_STRING, Buffer.concat([Buffer.of(unusedBits), content]));
}

/**
 * An `OCTET STRING`.
 *
 * @param content - The bytes.
 * @returns The encoded octet string.
 */
export function octetString(content: Buffer): Buffer {
  return tlv(TAG.OCTET_STRING, content);
}

/**
 * A `UTF8String`.
 *
 * Every string this service writes into a name is UTF-8, including ones that would fit
 * `PrintableString`. A single string type means a workspace called `Fürst & Co` and one
 * called `Acme` are encoded by the same code path, and the alternative — choosing the
 * narrower type when the characters allow — is a branch whose two sides get different
 * amounts of testing.
 *
 * @param value - The text.
 * @returns The encoded string.
 */
export function utf8String(value: string): Buffer {
  return tlv(TAG.UTF8_STRING, Buffer.from(value, "utf8"));
}

/**
 * ASCII text as bytes, refused rather than mangled if it is not ASCII.
 *
 * `Buffer.from(…, "ascii")` truncates every code point above 127 to its low seven bits, which
 * turns an unencodable string into a different, encodable one. Every IA5 value in a
 * certificate goes through here so that cannot happen quietly.
 *
 * @param value - The text.
 * @returns Its bytes.
 * @throws {RangeError} If the value is not ASCII.
 */
export function ascii(value: string): Buffer {
  // eslint-disable-next-line no-control-regex -- IA5 *is* the 0–127 range; naming it is the check.
  if (!/^[\x00-\x7f]*$/.test(value)) {
    throw new RangeError("An IA5String is ASCII.");
  }

  return Buffer.from(value, "latin1");
}

/**
 * An `IA5String` — ASCII, which is what a URI is.
 *
 * @param value - The text.
 * @returns The encoded string.
 * @throws {RangeError} If the value is not ASCII.
 */
export function ia5String(value: string): Buffer {
  return tlv(TAG.IA5_STRING, ascii(value));
}

/**
 * An `OBJECT IDENTIFIER`, from its dotted form.
 *
 * @param dotted - The identifier, `1.2.840.10045.4.3.2` and the like.
 * @returns The encoded OID: the first two arcs folded into one byte, then base-128 with the
 *   continuation bit set on every byte but the last of each arc.
 * @throws {RangeError} If fewer than two arcs are given, or an arc is not a non-negative
 *   integer — both of which are typos in a constant rather than run-time conditions.
 */
export function oid(dotted: string): Buffer {
  const arcs = dotted.split(".").map((arc) => Number(arc));

  if (arcs.length < 2 || arcs.some((arc) => !Number.isSafeInteger(arc) || arc < 0)) {
    throw new RangeError(`Not an object identifier: ${dotted}`);
  }

  const [first, second, ...rest] = arcs as [number, number, ...number[]];
  const bytes = [first * 40 + second, ...rest.flatMap(base128)];

  return tlv(TAG.OID, Buffer.from(bytes));
}

/** How many bits of a byte carry an OID arc's payload; the eighth is the continuation flag. */
const BASE128_BITS = 7;
const BASE128_MASK = 0x7f;

/**
 * One OID arc, base-128 with continuation bits.
 *
 * @param arc - The arc's value.
 * @returns Its bytes, high-order group first, every byte but the last carrying `0x80`.
 */
function base128(arc: number): number[] {
  const groups: number[] = [];
  let remaining = arc;
  do {
    groups.unshift(remaining & BASE128_MASK);
    remaining = Math.floor(remaining / (1 << BASE128_BITS));
  } while (remaining > 0);

  return groups.map((group, index) =>
    index === groups.length - 1 ? group : group | LONG_FORM_FLAG,
  );
}

/**
 * `[n] { … }` — a context-specific, constructed, explicit tag.
 *
 * @param tagNumber - The `n`.
 * @param content - The already-encoded value it wraps. Explicit tagging keeps the inner
 *   type's own tag, which is why this takes a complete encoding rather than raw content.
 * @returns The wrapped value.
 */
export function explicit(tagNumber: number, content: Buffer): Buffer {
  return tlv(CONTEXT_CONSTRUCTED | tagNumber, content);
}

/**
 * `[n] IMPLICIT` over a primitive — the form a `GeneralName` takes.
 *
 * @param tagNumber - The `n`. `6` is `uniformResourceIdentifier`, `2` is `dNSName`.
 * @param content - The value's *content* bytes, with the original type's tag dropped —
 *   which is what implicit tagging means and why this differs from {@link explicit}.
 * @returns The tagged value.
 */
export function implicitPrimitive(tagNumber: number, content: Buffer): Buffer {
  return tlv(CONTEXT_PRIMITIVE | tagNumber, content);
}

/**
 * `[n] IMPLICIT` over a constructed type — a `GeneralNames` sequence inside an extension.
 *
 * @param tagNumber - The `n`.
 * @param members - The members, already encoded.
 * @returns The tagged sequence.
 */
export function implicitSequence(tagNumber: number, ...members: Buffer[]): Buffer {
  return tlv(CONTEXT_CONSTRUCTED | tagNumber, Buffer.concat(members));
}

/**
 * The two-digit year boundary RFC 5280 draws.
 *
 * A validity time strictly before 2050 is a `UTCTime` with a two-digit year; 2050 and after
 * is a `GeneralizedTime` with four. The rule is the standard's, not a preference, and a CA
 * that ignored it would issue certificates some verifiers date a century wrong.
 */
const GENERALIZED_TIME_YEAR = 2050;

/**
 * A validity time, in whichever of the two encodings RFC 5280 requires for its year.
 *
 * Always UTC, always with seconds, always `Z` — the standard's own profile, which removes
 * the offsets and the fractional seconds ASN.1 would otherwise allow.
 *
 * @param at - The instant. Sub-second precision is dropped, because neither encoding can
 *   carry it in this profile.
 * @returns The encoded time.
 */
export function time(at: Date): Buffer {
  const iso = at.toISOString();
  const [year, rest] = [iso.slice(0, 4), iso.slice(5, 19).replace(/[-:T]/g, "")];

  return Number(year) < GENERALIZED_TIME_YEAR
    ? tlv(TAG.UTC_TIME, Buffer.from(`${year.slice(2)}${rest}Z`, "latin1"))
    : tlv(TAG.GENERALIZED_TIME, Buffer.from(`${year}${rest}Z`, "latin1"));
}
