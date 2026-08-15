import { randomBytes } from "node:crypto";

import {
  CIPHER,
  ENVELOPE_FORMAT,
  ENVELOPE_MAGIC,
  KEY_BYTES,
  NONCE_BYTES,
  TAG_BYTES,
  canonicalAad,
  formatEnvelope,
  isEnvelope,
  open,
  parseEnvelope,
  seal,
  zeroize,
} from "./envelope";
import { VaultCryptoError } from "./vault.errors";

/**
 * The cryptography, on its own — no database, no workspace, no service.
 *
 * Three of [#222](https://github.com/NobuData/ouroboros/issues/222)'s acceptance criteria
 * are properties of these functions and of nothing else, and are asserted here at the level
 * they actually hold: **a bit flipped anywhere fails authentication**, **the additional data
 * is unforgeable**, and **the envelope round-trips exactly**. `vault.service.spec.ts` asserts
 * the same properties again through the workspace-and-record vocabulary a caller uses, which
 * is where "another tenant" becomes a thing you can say.
 */

const KEY = Buffer.alloc(KEY_BYTES, 3);
const AAD = canonicalAad("ouro-vault:v1", "org-a", "record-1");

describe("the cipher this module is built on", () => {
  it("is AES-256-GCM with a 96-bit nonce and a full 128-bit tag", () => {
    // The mockup's copy and decision P2 name the cipher, the issue names the nonce size, and
    // nothing here truncates the tag. Stated as an assertion because all three are the kind
    // of constant that gets "optimised" by somebody who has read that shorter tags are legal.
    expect(CIPHER).toBe("aes-256-gcm");
    expect(KEY_BYTES).toBe(32);
    expect(NONCE_BYTES).toBe(12);
    expect(TAG_BYTES).toBe(16);
  });
});

describe("sealing and opening", () => {
  it("round-trips a payload exactly", () => {
    const plaintext = Buffer.from("sk-ant-api03-not-a-real-key", "utf8");
    const sealed = seal(KEY, AAD, plaintext);

    expect(open(KEY, AAD, sealed)).toEqual(plaintext);
  });

  it.each([
    ["an empty secret", 0],
    ["one byte", 1],
    ["a typical API key", 51],
    ["a PEM-sized credential", 3200],
  ])("round-trips %s", (_description, size) => {
    const plaintext = randomBytes(size);

    expect(open(KEY, AAD, seal(KEY, AAD, plaintext))).toEqual(plaintext);
  });

  it("round-trips bytes that are not valid UTF-8, so a binary credential survives", () => {
    // A service-account key file or a DER certificate is not text, and a helper that went
    // through a string on the way would corrupt it silently.
    const plaintext = Buffer.from([0xff, 0xfe, 0x00, 0x80, 0xc0]);

    expect(open(KEY, AAD, seal(KEY, AAD, plaintext))).toEqual(plaintext);
  });

  it("uses a fresh nonce every time, so the same secret never seals to the same bytes", () => {
    // Nonce reuse under one key loses GCM's confidentiality *and* its authentication, and
    // the way it happens is a nonce derived from something stable. Two seals of one value
    // differing is the observable form of "this came from the CSPRNG".
    const plaintext = Buffer.from("the same secret twice", "utf8");
    const first = seal(KEY, AAD, plaintext);
    const second = seal(KEY, AAD, plaintext);

    expect(first.nonce).not.toEqual(second.nonce);
    expect(first.ciphertext).not.toEqual(second.ciphertext);
    expect(open(KEY, AAD, first)).toEqual(open(KEY, AAD, second));
  });

  it("appends the tag, so the ciphertext is exactly the plaintext plus 16 bytes", () => {
    const plaintext = randomBytes(40);

    expect(seal(KEY, AAD, plaintext).ciphertext.byteLength).toBe(40 + TAG_BYTES);
  });

  it.each([31, 33, 16, 0])("refuses a %s-byte key rather than stretching it", (size) => {
    expect(() => seal(Buffer.alloc(size, 1), AAD, Buffer.from("x"))).toThrow(VaultCryptoError);
    expect(() => open(Buffer.alloc(size, 1), AAD, seal(KEY, AAD, Buffer.from("x")))).toThrow(
      VaultCryptoError,
    );
  });
});

describe("tampering", () => {
  const plaintext = Buffer.from("rotate-me-please", "utf8");

  /**
   * Flip the lowest bit of one byte.
   *
   * @param buffer - What to alter. Copied, so the original is left alone.
   * @param index - Which byte.
   * @returns The altered copy.
   */
  function flip(buffer: Buffer, index: number): Buffer {
    const altered = Buffer.from(buffer);
    altered[index] ^= 0x01;
    return altered;
  }

  // The acceptance criterion, stated as the issue states it: *a single bit flipped in the
  // ciphertext produces an authentication failure, not garbage plaintext*. Every byte is
  // tried rather than a representative one, because "the tag covers the whole message" is
  // exactly the kind of claim that holds for the byte somebody happened to pick.
  it("fails authentication for a single flipped bit anywhere in the ciphertext", () => {
    const sealed = seal(KEY, AAD, plaintext);

    for (let index = 0; index < sealed.ciphertext.byteLength; index += 1) {
      expect(() =>
        open(KEY, AAD, { nonce: sealed.nonce, ciphertext: flip(sealed.ciphertext, index) }),
      ).toThrow(VaultCryptoError);
    }
  });

  it("fails authentication for a single flipped bit anywhere in the nonce", () => {
    const sealed = seal(KEY, AAD, plaintext);

    for (let index = 0; index < sealed.nonce.byteLength; index += 1) {
      expect(() =>
        open(KEY, AAD, { nonce: flip(sealed.nonce, index), ciphertext: sealed.ciphertext }),
      ).toThrow(VaultCryptoError);
    }
  });

  it("never returns a partial plaintext — the failure is total", () => {
    // GCM checks the tag in `final()`, so there is no state in which some bytes come back
    // and then it throws. Worth an explicit assertion because "authentication failure, not
    // garbage plaintext" is the half of the criterion a caller depends on.
    const sealed = seal(KEY, AAD, plaintext);
    let returned: Buffer | undefined;

    try {
      returned = open(KEY, AAD, { nonce: sealed.nonce, ciphertext: flip(sealed.ciphertext, 0) });
    } catch {
      returned = undefined;
    }

    expect(returned).toBeUndefined();
  });

  it("fails authentication for a truncated ciphertext", () => {
    const sealed = seal(KEY, AAD, plaintext);

    expect(() =>
      open(KEY, AAD, { nonce: sealed.nonce, ciphertext: sealed.ciphertext.subarray(0, 8) }),
    ).toThrow(VaultCryptoError);
  });

  it("fails for the wrong key, and says nothing about which key", () => {
    const sealed = seal(KEY, AAD, plaintext);

    expect(() => open(Buffer.alloc(KEY_BYTES, 4), AAD, sealed)).toThrow(VaultCryptoError);
  });

  it("never puts any part of the value in the failure message", () => {
    const sealed = seal(KEY, AAD, plaintext);

    try {
      open(Buffer.alloc(KEY_BYTES, 4), AAD, sealed);
      throw new Error("expected the open to fail");
    } catch (error) {
      const message = (error as Error).message;

      expect(message).not.toContain(sealed.ciphertext.toString("base64url"));
      expect(message).not.toContain(sealed.nonce.toString("base64url"));
      expect(message).not.toContain(KEY.toString("base64"));
    }
  });
});

describe("the additional authenticated data", () => {
  it("binds a value to exactly one pair of identifiers", () => {
    const sealed = seal(KEY, canonicalAad("ctx", "org-a", "record-1"), Buffer.from("v"));

    expect(() => open(KEY, canonicalAad("ctx", "org-b", "record-1"), sealed)).toThrow(
      VaultCryptoError,
    );
    expect(() => open(KEY, canonicalAad("ctx", "org-a", "record-2"), sealed)).toThrow(
      VaultCryptoError,
    );
    expect(() => open(KEY, canonicalAad("other", "org-a", "record-1"), sealed)).toThrow(
      VaultCryptoError,
    );
  });

  // The attack the obvious encoding permits, and the reason `canonicalAad` writes lengths.
  // Joining on a separator makes ("acme:1", "2") and ("acme", "1:2") the same bytes, so a
  // record id an attacker chose could be made to match another tenant's binding — at which
  // point the swap-prevention criterion is satisfied on paper and not in fact.
  it("cannot be forged by choosing identifiers that contain the separator", () => {
    expect(canonicalAad("ctx", "acme:1", "2")).not.toEqual(canonicalAad("ctx", "acme", "1:2"));
    expect(canonicalAad("ctx", "a", "bc")).not.toEqual(canonicalAad("ctx", "ab", "c"));
    expect(canonicalAad("ctx", "", "ab")).not.toEqual(canonicalAad("ctx", "ab", ""));
  });

  it("is stable, so a value sealed today opens tomorrow", () => {
    expect(canonicalAad("ctx", "org-a", "record-1")).toEqual(
      canonicalAad("ctx", "org-a", "record-1"),
    );
    expect(canonicalAad("ctx", "org-a", "record-1").toString("utf8")).toBe(
      "3:ctx:5:org-a:8:record-1",
    );
  });

  it("counts bytes rather than characters, so a non-ASCII identifier is unambiguous too", () => {
    // "é" is one character and two bytes. A length in characters would make two different
    // pairs collide again, one alphabet further along than anybody would think to test.
    expect(canonicalAad("ctx", "é").toString("utf8")).toBe("3:ctx:2:é");
  });
});

describe("the envelope format", () => {
  it("round-trips through the string a consumer stores", () => {
    const sealed = seal(KEY, AAD, Buffer.from("stored", "utf8"));
    const parsed = parseEnvelope(formatEnvelope(3, sealed.nonce, sealed.ciphertext));

    expect(parsed.version).toBe(3);
    expect(parsed.nonce).toEqual(sealed.nonce);
    expect(parsed.ciphertext).toEqual(sealed.ciphertext);
    expect(open(KEY, AAD, parsed)).toEqual(Buffer.from("stored", "utf8"));
  });

  it("opens with the magic and the format version, then the key version", () => {
    const sealed = seal(KEY, AAD, Buffer.from("x"));
    const envelope = formatEnvelope(2, sealed.nonce, sealed.ciphertext);

    expect(envelope.split(".").slice(0, 3)).toEqual([ENVELOPE_MAGIC, ENVELOPE_FORMAT, "2"]);
  });

  it("uses an alphabet that cannot contain the separator", () => {
    // base64url is `A-Za-z0-9-_`, so no payload can ever contain a `.` and the parse is a
    // `split` that cannot be fooled by what was encrypted.
    const sealed = seal(KEY, AAD, randomBytes(256));
    const envelope = formatEnvelope(1, sealed.nonce, sealed.ciphertext);

    expect(envelope.split(".")).toHaveLength(5);
    expect(envelope).not.toContain("+");
    expect(envelope).not.toContain("/");
    expect(envelope).not.toContain("=");
  });

  it.each([
    ["too few fields", "ouro.v1.1.AAAA"],
    ["too many fields", "ouro.v1.1.AAAA.BBBB.CCCC"],
    ["another module's magic", "vault.v1.1.AAAA.BBBB"],
    ["a format version this release does not know", "ouro.v2.1.AAAA.BBBB"],
    ["a key version that is not a number", "ouro.v1.one.AAAA.BBBB"],
    ["a key version with trailing text", "ouro.v1.1abc.AAAA.BBBB"],
    ["key version zero", "ouro.v1.0.AAAA.BBBB"],
    ["", ""],
  ])("refuses %s", (_description, value) => {
    expect(() => parseEnvelope(value)).toThrow(VaultCryptoError);
  });

  it("refuses a nonce that is not 96 bits", () => {
    const short = Buffer.alloc(NONCE_BYTES - 1, 1).toString("base64url");

    expect(() =>
      parseEnvelope(`ouro.v1.1.${short}.${Buffer.alloc(32).toString("base64url")}`),
    ).toThrow(VaultCryptoError);
  });

  it("refuses a value shorter than its own authentication tag", () => {
    const nonce = Buffer.alloc(NONCE_BYTES, 1).toString("base64url");
    const stub = Buffer.alloc(TAG_BYTES - 1, 1).toString("base64url");

    expect(() => parseEnvelope(`ouro.v1.1.${nonce}.${stub}`)).toThrow(VaultCryptoError);
  });

  it("never quotes the value it refused", () => {
    const secret = "ouro.v1.1.this-is-not-base64-nonce.and-neither-is-this";

    try {
      parseEnvelope(secret);
      throw new Error("expected the parse to fail");
    } catch (error) {
      expect((error as Error).message).not.toContain("this-is-not-base64-nonce");
    }
  });
});

describe("recognising a sealed value", () => {
  it("says yes to something this module sealed", () => {
    const sealed = seal(KEY, AAD, Buffer.from("x"));

    expect(isEnvelope(formatEnvelope(1, sealed.nonce, sealed.ciphertext))).toBe(true);
  });

  // The migration's question: is this already ours, or is it a value from before this
  // service existed that has to be adopted?
  it.each(["sk-ant-api03-plaintext", "", "ouro", "ouro.v2.1.a.b", "OURO.V1.1.a.b"])(
    "says no to %s",
    (value) => {
      expect(isEnvelope(value)).toBe(false);
    },
  );

  it("is a prefix test, so a corrupt envelope is still recognised as ours", () => {
    // Deliberate: a corrupt value of ours must be reported as a broken record, not silently
    // re-encrypted as though the ciphertext were the plaintext.
    expect(isEnvelope("ouro.v1.1.truncated")).toBe(true);
  });
});

describe("zeroization", () => {
  it("overwrites a buffer in place", () => {
    const key = randomBytes(KEY_BYTES);

    zeroize(key);

    expect(key).toEqual(Buffer.alloc(KEY_BYTES));
  });

  it("overwrites several, and tolerates one that was never assigned", () => {
    // The `finally` shape every caller uses: a variable declared before the `try` may still
    // be undefined if the operation that assigns it threw.
    const first = randomBytes(8);
    const second = randomBytes(8);
    let never: Buffer | undefined;

    zeroize(first, never, second);

    expect(first).toEqual(Buffer.alloc(8));
    expect(second).toEqual(Buffer.alloc(8));
    expect(never).toBeUndefined();
  });
});
