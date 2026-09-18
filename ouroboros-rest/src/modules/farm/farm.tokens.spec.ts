import {
  maskToken,
  mintToken,
  parseToken,
  randomSecret,
  verifySecret,
  MASK_GLYPH,
  MASK_WIDTH,
  TOKEN_PREFIX,
} from "./farm.tokens";
import { TOKEN_SECRET_BYTES } from "./farm.policy";

/** A token id shaped the way `crypto.randomUUID()` produces one. */
const ID = "7f3a9c1e-4b0d-4e2a-8f6b-5c3d1e0f2a4b";

/**
 * `orb_enroll_…`, and the three properties its shape exists for.
 *
 * The one worth restating is the third: **there is no function here that can produce a mask
 * from a secret**. That is what makes *the full value is returned exactly once* a property the
 * compiler keeps rather than a rule about call sites, and the test for it is a type-level fact
 * asserted at the value level — `maskToken` takes an id.
 */

describe("minting", () => {
  it("composes the prefix, the row's packed id and the secret", () => {
    const token = mintToken(ID, "s3cret-value-that-is-long-enough-to-pass");

    expect(token.value).toBe(
      `${TOKEN_PREFIX}7f3a9c1e4b0d4e2a8f6b5c3d1e0f2a4b.s3cret-value-that-is-long-enough-to-pass`,
    );
    expect(token.id).toBe(ID);
  });

  it("generates 256 bits of secret when it is not given one", () => {
    expect(Buffer.from(randomSecret(), "base64url")).toHaveLength(TOKEN_SECRET_BYTES);
  });

  it("generates a different secret every time", () => {
    const secrets = new Set(Array.from({ length: 100 }, () => randomSecret()));

    expect(secrets.size).toBe(100);
  });

  it("is one shell word — nothing a shell would quote or a URL would escape", () => {
    // It travels on a command line in a `curl | sh` one-liner.
    expect(mintToken(ID).value).toMatch(/^[A-Za-z0-9_.-]+$/);
  });
});

describe("parsing a presented token", () => {
  it("recovers the row's id, so nothing has to be searched for", () => {
    // V040's header: the envelope is not searchable, and a lookup column beside it would be a
    // second place for the secret to leak from.
    expect(parseToken(mintToken(ID, "aaaaaaaaaaaaaaaaaaaaaaaa").value)).toEqual({
      id: ID,
      secret: "aaaaaaaaaaaaaaaaaaaaaaaa",
    });
  });

  it("answers undefined rather than throwing, for every malformed shape", () => {
    // The caller answers every enrollment failure with one refusal, so *the wrong shape* and
    // *names no row* have to be indistinguishable from outside.
    for (const bad of [
      "",
      "hello",
      "orb_enroll_",
      `${TOKEN_PREFIX}notahexid.aaaaaaaaaaaaaaaaaaaaaaaa`,
      `${TOKEN_PREFIX}7f3a9c1e4b0d4e2a8f6b5c3d1e0f2a4b`,
      `${TOKEN_PREFIX}7f3a9c1e4b0d4e2a8f6b5c3d1e0f2a4b.short`,
      `${TOKEN_PREFIX}7f3a9c1e4b0d4e2a8f6b5c3d1e0f2a4b.aaaaaaaaaaaaaaaaaaaaaaaa.extra`,
      `${TOKEN_PREFIX}7f3a9c1e4b0d4e2a8f6b5c3d1e0f2a4b.aaaa aaaa aaaa aaaaaaaaa`,
    ]) {
      expect(parseToken(bad)).toBeUndefined();
    }
  });

  it("refuses an upper-case id, because a uuid is stored lower-case", () => {
    expect(
      parseToken(`${TOKEN_PREFIX}7F3A9C1E4B0D4E2A8F6B5C3D1E0F2A4B.aaaaaaaaaaaaaaaaaaaaaaaa`),
    ).toBeUndefined();
  });

  it("round-trips whatever was minted", () => {
    const token = mintToken(ID);

    expect(parseToken(token.value)).toEqual({ id: token.id, secret: token.secret });
  });
});

describe("verifying a secret", () => {
  it("accepts the one that was sealed", () => {
    expect(verifySecret("abc", "abc")).toBe(true);
  });

  it("refuses a different one of the same length", () => {
    expect(verifySecret("abc", "abd")).toBe(false);
  });

  it("refuses a different length without throwing", () => {
    // `timingSafeEqual` throws on a length mismatch rather than answering false, and a length
    // difference is not a secret — the width is a published constant.
    expect(verifySecret("ab", "abc")).toBe(false);
    expect(verifySecret("", "abc")).toBe(false);
  });
});

describe("masking", () => {
  it("is the mockup's bullets, with enough of the public id to tell two tokens apart", () => {
    expect(maskToken(ID)).toBe(`${TOKEN_PREFIX}${MASK_GLYPH.repeat(MASK_WIDTH)}2a4b`);
  });

  it("distinguishes two tokens in a list", () => {
    expect(maskToken(ID)).not.toBe(maskToken("7f3a9c1e-4b0d-4e2a-8f6b-5c3d1e0f2999"));
  });

  it("is computed from the id, which is the whole of the once-only guarantee", () => {
    // There is no parameter here a secret could be passed to. A mask that took the value would
    // be a mask that could be called after the mint response, and the plaintext would then have
    // to exist somewhere for it to be called with.
    const token = mintToken(ID);

    expect(maskToken(token.id)).not.toContain(token.secret);
    expect(maskToken(token.id)).not.toContain(token.secret.slice(0, 4));
  });
});
