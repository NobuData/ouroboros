/**
 * The only DER *parser* in this module, and the argument for keeping it this small.
 *
 * AH.2 ([#250](https://github.com/NobuData/ouroboros/issues/250)). `der.ts` writes shapes
 * this service chose. This file reads one shape an agent chose — a PKCS#10 certification
 * request — which is a different risk entirely: the bytes arrive over HTTP from a machine
 * that has not yet proved anything about itself, and every length in them is a number an
 * attacker picked.
 *
 * So the posture here is *structural walk, nothing more*:
 *
 *   * **It reads headers, never values.** Nothing in this file decodes an integer, a string,
 *     a time or an object identifier. `csr.ts` uses it to find the one substructure it wants
 *     — the `SubjectPublicKeyInfo` — and hands those bytes to `crypto.createPublicKey`,
 *     which is a parser written in C that the platform maintains. A hand-written EC point
 *     decoder would be the actual dangerous thing, and there is not one.
 *   * **Every read is bounds-checked against the buffer, and lengths are checked against
 *     their own container.** A length that runs past its parent is refused, not clamped:
 *     clamping is how a parser ends up reading a field from a neighbour's bytes.
 *   * **DER, not BER.** Indefinite lengths are refused, and a length encoded in more bytes
 *     than it needs is refused. Both are legal BER and neither is legal DER, and accepting
 *     them would mean two byte strings could parse to the same structure — which is how a
 *     signature gets verified over one reading and interpreted as another.
 *   * **Nesting is bounded.** A request is four levels deep; {@link MAX_DEPTH} allows eight.
 *     Without it, a few kilobytes of nested `SEQUENCE` headers is a stack overflow.
 *
 * Everything it refuses, it refuses by throwing {@link DerFormatError}, which `csr.ts` turns
 * into one `422` naming the field. There is no partial success: a request that is not
 * exactly the shape below is not a request.
 */

/** What a malformed structure raises. Caught at the module boundary; never shown verbatim. */
export class DerFormatError extends Error {}

/** How deep {@link children} will descend before giving up. See this file's header. */
export const MAX_DEPTH = 8;

/** The bit in a length's first byte that marks the long form. */
const LONG_FORM_FLAG = 0x80;

/** The most length bytes accepted — four is 4 GiB, and a request is a few hundred bytes. */
const MAX_LENGTH_BYTES = 4;

/** The bit in an identifier octet that marks a constructed type. */
const CONSTRUCTED_FLAG = 0x20;

/** One element, located. */
export interface Element {
  /** Its identifier octet. */
  readonly tag: number;
  /** Where its identifier octet is — the first byte of the element itself. */
  readonly start: number;
  /** Where its contents begin. */
  readonly contentAt: number;
  /** How many bytes of contents there are. */
  readonly length: number;
  /** One past its last byte — where a sibling would begin. */
  readonly end: number;
}

/**
 * Read the element beginning at an offset.
 *
 * @param der - The bytes.
 * @param at - Where the identifier octet is.
 * @param limit - One past the last byte this element may occupy — its parent's end, or the
 *   buffer's length at the top level. Passed explicitly because "fits in the buffer" is a
 *   weaker check than "fits in its container", and only the second one stops a nested field
 *   from reaching into the bytes after it.
 * @returns The element.
 * @throws {DerFormatError} If it is truncated, indefinite-length, over-long-encoded, or
 *   runs past `limit`.
 */
export function read(der: Buffer, at: number, limit: number = der.length): Element {
  const tag = der[at];
  const first = der[at + 1];

  if (tag === undefined || first === undefined || at + 2 > limit) {
    throw new DerFormatError("Truncated.");
  }

  if (first < LONG_FORM_FLAG) {
    return located(tag, at, at + 2, first, limit);
  }

  const count = first & ~LONG_FORM_FLAG;

  // `0x80` on its own is BER's indefinite length: contents until an end-of-contents marker.
  // Legal BER, illegal DER, and the one length form whose end a bounds check cannot predict.
  if (count === 0) throw new DerFormatError("Indefinite lengths are not DER.");
  if (count > MAX_LENGTH_BYTES) throw new DerFormatError("Length too large.");

  let length = 0;
  for (let index = 0; index < count; index += 1) {
    const byte = der[at + 2 + index];
    if (byte === undefined) throw new DerFormatError("Truncated.");
    length = length * 0x100 + byte;
  }

  // Minimal encoding, both halves: a long form that a short form could have expressed, and a
  // long form with a leading zero byte. Either would let two encodings mean one structure.
  if (length < LONG_FORM_FLAG) throw new DerFormatError("Non-minimal length.");
  if (der[at + 2] === 0x00) throw new DerFormatError("Non-minimal length.");

  return located(tag, at, at + 2 + count, length, limit);
}

/**
 * Check an element's extent and return it.
 *
 * @param tag - Its identifier octet.
 * @param start - Where that octet is.
 * @param contentAt - Where its contents begin.
 * @param length - How long they are.
 * @param limit - One past the last byte it may occupy.
 * @returns The element.
 * @throws {DerFormatError} If it would run past `limit`.
 */
function located(
  tag: number,
  start: number,
  contentAt: number,
  length: number,
  limit: number,
): Element {
  const end = contentAt + length;
  if (end > limit) throw new DerFormatError("Element runs past its container.");

  return { tag, start, contentAt, length, end };
}

/**
 * The elements inside a constructed one.
 *
 * @param der - The bytes.
 * @param parent - The constructed element, from {@link read}.
 * @param depth - How deep this call already is. Callers pass nothing; the guard exists for
 *   the recursive case a future reader might add.
 * @returns Its children, in order.
 * @throws {DerFormatError} If the element is primitive, if a child is malformed, if the
 *   children do not exactly fill the parent, or if {@link MAX_DEPTH} is exceeded.
 */
export function children(der: Buffer, parent: Element, depth = 0): Element[] {
  if (depth >= MAX_DEPTH) throw new DerFormatError("Too deeply nested.");
  if ((parent.tag & CONSTRUCTED_FLAG) === 0) throw new DerFormatError("Not a constructed type.");

  const found: Element[] = [];
  let at = parent.contentAt;

  while (at < parent.end) {
    const child = read(der, at, parent.end);
    found.push(child);
    at = child.end;
  }

  // Equality rather than `<=`: the loop cannot overshoot, because `read` refuses an element
  // that would, so a mismatch here would mean a child ended mid-byte — which is impossible.
  // It is asserted anyway, because the cost is one comparison and the alternative is trusting
  // an invariant across two functions.
  if (at !== parent.end) throw new DerFormatError("Children do not fill their container.");

  return found;
}

/**
 * The child at an index, or a refusal naming what was expected.
 *
 * @param elements - The children.
 * @param index - Which one.
 * @param what - What it should have been, for the message.
 * @returns The element.
 * @throws {DerFormatError} If there is no child there.
 */
export function at(elements: readonly Element[], index: number, what: string): Element {
  const element = elements[index];
  if (!element) throw new DerFormatError(`Missing ${what}.`);

  return element;
}

/**
 * An element's own bytes, header included.
 *
 * What a signature is computed over, and what gets handed to a platform parser. The
 * certification request's signature covers the `CertificationRequestInfo` *as encoded*, so
 * re-encoding it here would be re-deriving bytes that already exist and would verify a
 * different string than the one that arrived.
 *
 * @param der - The bytes.
 * @param element - The element.
 * @returns A view of the original buffer — not a copy, because every caller either hashes it
 *   or passes it straight on, and neither mutates.
 */
export function bytesOf(der: Buffer, element: Element): Buffer {
  return der.subarray(element.start, element.end);
}
