import { at, bytesOf, children, read, DerFormatError, MAX_DEPTH } from "./reader";
import { integer, octetString, sequence, tlv, TAG } from "./der";

/**
 * The parser, asked the questions an attacker would ask.
 *
 * Every refusal in `reader.ts` is a specific malformed structure somebody could send to the
 * unauthenticated enrollment endpoint, so each one gets a test that constructs that structure
 * by hand. The happy path is one test; the seven ways in is the suite.
 */

/** A well-formed nesting, for the tests that are about something else. */
const NESTED = sequence(integer(1), octetString(Buffer.of(0xaa, 0xbb)));

describe("reading one element", () => {
  it("locates its tag, its contents and its end", () => {
    const element = read(NESTED, 0);

    expect(element.tag).toBe(TAG.SEQUENCE);
    expect(element.start).toBe(0);
    expect(element.end).toBe(NESTED.length);
  });

  it("reads a long-form length", () => {
    const long = tlv(TAG.OCTET_STRING, Buffer.alloc(300));

    expect(read(long, 0).length).toBe(300);
  });

  it("refuses an indefinite length, which is BER and not DER", () => {
    // 0x80 alone: contents until an end-of-contents marker. The one length form whose end a
    // bounds check cannot predict.
    expect(() => read(Buffer.of(0x30, 0x80, 0x00, 0x00), 0)).toThrow(DerFormatError);
  });

  it("refuses a length encoded in more bytes than it needs", () => {
    // Both halves: a long form a short form could have expressed, and a long form with a
    // leading zero. Either would let two byte strings mean one structure — which is how a
    // signature gets verified over one reading and interpreted as another.
    expect(() => read(Buffer.of(0x04, 0x81, 0x01, 0xaa), 0)).toThrow(DerFormatError);
    expect(() => read(Buffer.of(0x04, 0x82, 0x00, 0x81, ...Buffer.alloc(129)), 0)).toThrow(
      DerFormatError,
    );
  });

  it("refuses a length that would need more than four bytes", () => {
    expect(() => read(Buffer.of(0x04, 0x85, 0x01, 0x00, 0x00, 0x00, 0x00), 0)).toThrow(
      DerFormatError,
    );
  });

  it("refuses an element that is truncated", () => {
    expect(() => read(Buffer.of(0x30), 0)).toThrow(DerFormatError);
    expect(() => read(Buffer.alloc(0), 0)).toThrow(DerFormatError);
  });

  it("refuses an element that runs past its container, not merely past the buffer", () => {
    // The check that matters: a child whose length reaches into the bytes *after* its parent
    // still fits in the buffer, and clamping it is how a parser reads a field from a
    // neighbour's bytes.
    const parent = read(NESTED, 0);

    expect(() => read(NESTED, parent.contentAt, parent.contentAt + 1)).toThrow(DerFormatError);
  });
});

describe("reading a constructed element's children", () => {
  it("returns them in order", () => {
    const [first, second] = children(NESTED, read(NESTED, 0));

    expect(first?.tag).toBe(TAG.INTEGER);
    expect(second?.tag).toBe(TAG.OCTET_STRING);
  });

  it("refuses a primitive", () => {
    const primitive = octetString(Buffer.of(0x01));

    expect(() => children(primitive, read(primitive, 0))).toThrow(DerFormatError);
  });

  it("refuses children that do not exactly fill their parent", () => {
    // A sequence claiming three bytes of contents holding a two-byte child.
    const ragged = Buffer.of(0x30, 0x03, 0x02, 0x01, 0x01, 0x00);

    expect(() =>
      children(ragged, { tag: 0x30, start: 0, contentAt: 2, length: 4, end: 6 }),
    ).toThrow(DerFormatError);
  });

  it("refuses to descend past the depth limit", () => {
    // Without the guard, a few kilobytes of nested SEQUENCE headers is a stack overflow — and
    // a few kilobytes is what the enrollment endpoint accepts from an unauthenticated caller.
    // Asserted at the parameter rather than by building the structure, because what is being
    // checked is that the counter is honoured; `descend` below proves it is threaded.
    expect(() => children(NESTED, read(NESTED, 0), MAX_DEPTH)).toThrow(DerFormatError);
    expect(() => children(NESTED, read(NESTED, 0), MAX_DEPTH - 1)).not.toThrow();
  });

  it("is used by a walk that threads the depth through", () => {
    // MAX_DEPTH levels is what the reader allows and a certification request is four, so the
    // deepest legitimate structure this module reads has headroom — and one level past the
    // limit is refused rather than recursed into.
    let deep = integer(1);
    for (let level = 0; level <= MAX_DEPTH; level += 1) deep = sequence(deep);

    const descend = (buffer: Buffer, element = read(buffer, 0), depth = 0): number => {
      if ((element.tag & 0x20) === 0) return depth;

      const [child] = children(buffer, element, depth);

      return child ? descend(buffer, child, depth + 1) : depth;
    };

    expect(() => descend(deep)).toThrow(DerFormatError);
  });
});

describe("naming what was expected", () => {
  it("refuses a missing child by name", () => {
    expect(() => at([], 2, "subject public key info")).toThrow(/subject public key info/);
  });
});

describe("an element's own bytes", () => {
  it("include its header, because that is what a signature covers", () => {
    // The certification request's signature covers the `CertificationRequestInfo` *as
    // encoded*: re-encoding it would verify a different string than the one that arrived.
    const [first] = children(NESTED, read(NESTED, 0));

    expect(bytesOf(NESTED, at([first], 0, "first"))).toEqual(integer(1));
  });

  it("works for a long-form header too", () => {
    const long = sequence(octetString(Buffer.alloc(300)));
    const [child] = children(long, read(long, 0));

    expect(bytesOf(long, child)).toHaveLength(300 + 4);
  });
});
