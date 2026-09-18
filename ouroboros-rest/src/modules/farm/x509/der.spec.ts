import {
  ascii,
  bitString,
  boolean,
  explicit,
  ia5String,
  implicitPrimitive,
  implicitSequence,
  integer,
  octetString,
  oid,
  sequence,
  set,
  time,
  tlv,
  TAG,
} from "./der";

/**
 * The encoder, held to DER rather than to itself.
 *
 * Every assertion below is a byte string from the standard or one `openssl asn1parse` would
 * produce — never `encode(x)` compared against `encode(x)`, which is the failure mode a
 * codec's own suite falls into. The two rules that are easy to get almost right, and whose
 * "almost" produces a certificate some verifiers accept and others reject, get the most
 * attention: **minimal lengths** and **signed minimal integers**.
 */

describe("the type-length-value primitive", () => {
  it("uses the short form up to 127 bytes", () => {
    expect(tlv(TAG.OCTET_STRING, Buffer.alloc(127))).toHaveLength(2 + 127);
    expect(tlv(TAG.OCTET_STRING, Buffer.alloc(127)).subarray(0, 2)).toEqual(Buffer.of(0x04, 0x7f));
  });

  it("switches to the long form at 128, counting the length's own bytes", () => {
    // 0x81 says "one length byte follows"; 0x80 is the length. A BER encoder allowed to use
    // two bytes here would produce a structure some parsers reject.
    expect(tlv(TAG.OCTET_STRING, Buffer.alloc(128)).subarray(0, 3)).toEqual(
      Buffer.of(0x04, 0x81, 0x80),
    );
  });

  it("uses exactly as many length bytes as the length needs", () => {
    expect(tlv(TAG.OCTET_STRING, Buffer.alloc(256)).subarray(0, 4)).toEqual(
      Buffer.of(0x04, 0x82, 0x01, 0x00),
    );
    expect(tlv(TAG.OCTET_STRING, Buffer.alloc(65_536)).subarray(0, 5)).toEqual(
      Buffer.of(0x04, 0x83, 0x01, 0x00, 0x00),
    );
  });

  it("encodes an empty value as a header alone", () => {
    expect(sequence()).toEqual(Buffer.of(0x30, 0x00));
  });
});

describe("an integer", () => {
  it("is big-endian", () => {
    expect(integer(1)).toEqual(Buffer.of(0x02, 0x01, 0x01));
    expect(integer(256)).toEqual(Buffer.of(0x02, 0x02, 0x01, 0x00));
  });

  it("encodes zero as one zero byte rather than as nothing", () => {
    expect(integer(0)).toEqual(Buffer.of(0x02, 0x01, 0x00));
  });

  it("pads a value whose top bit is set, so it does not read as negative", () => {
    // The case a serial number hits half the time. Without the pad, 0x80 is -128.
    expect(integer(128)).toEqual(Buffer.of(0x02, 0x02, 0x00, 0x80));
    expect(integer(Buffer.of(0xff, 0x01))).toEqual(Buffer.of(0x02, 0x03, 0x00, 0xff, 0x01));
  });

  it("drops redundant leading zeroes, which DER calls malformed", () => {
    expect(integer(Buffer.of(0x00, 0x00, 0x2a))).toEqual(Buffer.of(0x02, 0x01, 0x2a));
  });

  it("keeps one zero byte when the value is all zeroes", () => {
    expect(integer(Buffer.of(0x00, 0x00))).toEqual(Buffer.of(0x02, 0x01, 0x00));
  });

  it("refuses a negative number rather than encoding one", () => {
    // A negative serial is not a thing this service has any way to mean, so it is a bug at the
    // call site rather than a value to encode.
    expect(() => integer(-1)).toThrow(RangeError);
    expect(() => integer(1.5)).toThrow(RangeError);
  });
});

describe("a boolean", () => {
  it("is 0xFF for true, which is DER's choice rather than BER's", () => {
    expect(boolean(true)).toEqual(Buffer.of(0x01, 0x01, 0xff));
    expect(boolean(false)).toEqual(Buffer.of(0x01, 0x01, 0x00));
  });
});

describe("an object identifier", () => {
  it("folds the first two arcs into one byte", () => {
    // 2.5.29.19 — basicConstraints. 2*40 + 5 = 85 = 0x55.
    expect(oid("2.5.29.19")).toEqual(Buffer.of(0x06, 0x03, 0x55, 0x1d, 0x13));
  });

  it("encodes an arc above 127 in base 128 with continuation bits", () => {
    // 1.2.840.10045.4.3.2 — ecdsa-with-SHA256, the one algorithm this CA signs with. The bytes
    // are the standard's, and every certificate this module issues carries them twice.
    expect(oid("1.2.840.10045.4.3.2")).toEqual(Buffer.from("06082a8648ce3d040302", "hex"));
  });

  it("refuses something that is not an identifier", () => {
    expect(() => oid("1")).toThrow(RangeError);
    expect(() => oid("1.two.3")).toThrow(RangeError);
    expect(() => oid("1.-2")).toThrow(RangeError);
  });
});

describe("the string types", () => {
  it("writes ASCII without translating it", () => {
    expect(ascii("abc")).toEqual(Buffer.from("abc", "latin1"));
  });

  it("refuses non-ASCII where IA5 is required, rather than truncating it", () => {
    // `Buffer.from(…, "ascii")` would turn a non-ASCII character into a different, encodable
    // one — exactly the silent corruption this refusal exists to prevent.
    expect(() => ascii("ü")).toThrow(RangeError);
    expect(() => ia5String("urn:ouroboros:runner:ü")).toThrow(RangeError);
  });

  it("tags an IA5String as one", () => {
    expect(ia5String("a")).toEqual(Buffer.of(TAG.IA5_STRING, 0x01, 0x61));
  });
});

describe("the wrappers", () => {
  it("tags a bit string with its unused-bit count", () => {
    expect(bitString(Buffer.of(0x80), 7)).toEqual(Buffer.of(0x03, 0x02, 0x07, 0x80));
  });

  it("wraps an octet string", () => {
    expect(octetString(Buffer.of(0x01))).toEqual(Buffer.of(0x04, 0x01, 0x01));
  });

  it("keeps the inner tag when the tag is explicit", () => {
    // `[0] EXPLICIT INTEGER 2` — the version field of every v3 certificate.
    expect(explicit(0, integer(2))).toEqual(Buffer.of(0xa0, 0x03, 0x02, 0x01, 0x02));
  });

  it("replaces the inner tag when the tag is implicit", () => {
    // A `GeneralName`'s URI alternative: the IA5String's own tag is gone.
    expect(implicitPrimitive(6, Buffer.from("ab", "latin1"))).toEqual(
      Buffer.of(0x86, 0x02, 0x61, 0x62),
    );
  });

  it("marks an implicitly tagged sequence as constructed", () => {
    expect(implicitSequence(0, integer(1))).toEqual(Buffer.of(0xa0, 0x03, 0x02, 0x01, 0x01));
  });

  it("wraps a single-element set", () => {
    expect(set(integer(1))).toEqual(Buffer.of(0x31, 0x03, 0x02, 0x01, 0x01));
  });
});

describe("a validity time", () => {
  it("is a UTCTime with a two-digit year before 2050", () => {
    const encoded = time(new Date("2026-09-18T12:00:00.000Z"));

    expect(encoded[0]).toBe(TAG.UTC_TIME);
    expect(encoded.subarray(2).toString("latin1")).toBe("260918120000Z");
  });

  it("is a GeneralizedTime with four digits from 2050 on", () => {
    // RFC 5280's rule, and not a preference: a CA that ignored it would issue certificates
    // some verifiers date a century wrong.
    const encoded = time(new Date("2050-01-01T00:00:00.000Z"));

    expect(encoded[0]).toBe(TAG.GENERALIZED_TIME);
    expect(encoded.subarray(2).toString("latin1")).toBe("20500101000000Z");
  });

  it("drops sub-second precision, which neither encoding can carry in this profile", () => {
    expect(time(new Date("2026-09-18T12:00:00.750Z")).subarray(2).toString("latin1")).toBe(
      "260918120000Z",
    );
  });
});
