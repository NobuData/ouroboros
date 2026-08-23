import { FAKE_SECRET } from "../providers/adapters/fake.adapter.fixture";
import {
  MASK_GLYPH,
  MASK_ONLY,
  MASK_WIDTH,
  SUFFIX_LENGTH,
  TAIL_BYTES,
  credentialSuffix,
  maskCredential,
} from "./masking";

/**
 * What a masked credential is allowed to say.
 *
 * Every assertion here is really the same one from a different angle: *the mask carries no
 * more of the credential than its last four characters*. That is the property AD.2's contract
 * test greps payloads for, and this is where it is proved about the function rather than
 * about a response.
 */

/** A credential with four distinguishable characters at each end. */
const CREDENTIAL = "sk-ant-api03-AAAABBBBCCCCDDDDXq4A";

/** Its bytes, as the vault would hand them over. */
const bytes = (value: string): Buffer => Buffer.from(value, "utf8");

describe("masking a credential", () => {
  it("shows four bullets and the last four characters", () => {
    expect(maskCredential(bytes(CREDENTIAL))).toBe("••••Xq4A");
  });

  it("is the bullets and the suffix, and nothing else", () => {
    // Stated as an identity rather than as a literal, so the two exported halves cannot drift
    // apart from the whole they compose.
    const plaintext = bytes(CREDENTIAL);

    expect(maskCredential(plaintext)).toBe(`${MASK_ONLY}${credentialSuffix(plaintext)}`);
    expect(MASK_ONLY).toBe(MASK_GLYPH.repeat(MASK_WIDTH));
  });

  it("draws the same number of bullets whatever the credential's length", () => {
    // A mask whose width tracked the secret's length would publish the length, which is a
    // fact about a credential that nothing needs and a search space that narrows on.
    const short = maskCredential(bytes("abcdefgh"));
    const long = maskCredential(bytes(`${"x".repeat(400)}efgh`));

    expect(short).toHaveLength(long.length);
    expect(short).toBe("••••efgh");
    expect(long).toBe("••••efgh");
  });

  it("never contains more of the credential than its last four characters", () => {
    const mask = maskCredential(bytes(FAKE_SECRET));

    expect(mask).not.toContain(FAKE_SECRET);
    // Every window of five characters of the credential — one longer than the suffix — must
    // be absent. That is the assertion a "does it contain the whole key" check would miss if
    // somebody widened the suffix by one.
    for (let start = 0; start + SUFFIX_LENGTH + 1 <= FAKE_SECRET.length; start += 1) {
      expect(mask).not.toContain(FAKE_SECRET.slice(start, start + SUFFIX_LENGTH + 1));
    }
  });

  it("does not consume the buffer it was given", () => {
    // The caller owns the plaintext and is the one that zeroizes it — see `VaultService.decrypt`.
    // A masker that erased it would surprise a caller doing two things with one value.
    const plaintext = bytes(CREDENTIAL);

    maskCredential(plaintext);

    expect(plaintext.toString("utf8")).toBe(CREDENTIAL);
  });

  describe("a credential shorter than the suffix", () => {
    it.each([
      ["", MASK_ONLY],
      ["a", MASK_ONLY],
      ["abc", MASK_ONLY],
    ])("masks %p to bullets alone", (value, expected) => {
      // Showing all of a three-character secret while calling it a mask is the one failure
      // this module exists to prevent, so the answer degrades to bullets rather than to a
      // shorter suffix.
      expect(maskCredential(bytes(value))).toBe(expected);
      expect(credentialSuffix(bytes(value))).toBe("");
    });

    it("shows exactly the whole of a credential that is precisely four characters", () => {
      // The boundary, stated so that a change to `SUFFIX_LENGTH` has to think about it. Four
      // characters is not a credential any vendor issues; what matters is that the rule is
      // *last four*, applied without a special case.
      expect(maskCredential(bytes("wxyz"))).toBe("••••wxyz");
    });
  });

  describe("reading the tail rather than the whole buffer", () => {
    it("finds the last four characters of a credential far longer than the tail", () => {
      expect(credentialSuffix(bytes(`${"z".repeat(TAIL_BYTES * 4)}Xq4A`))).toBe("Xq4A");
    });

    it("survives a multi-byte character straddling the tail boundary", () => {
      // The tail is decoded generously and only the last four characters are taken, so a
      // decode that begins mid-character yields a replacement character that the slice
      // discards. Asserted because the alternative — decoding the whole buffer — is what
      // this function exists not to do.
      const value = `${"é".repeat(TAIL_BYTES)}Xq4A`;

      expect(credentialSuffix(bytes(value))).toBe("Xq4A");
      expect(maskCredential(bytes(value))).toBe("••••Xq4A");
    });

    it("does not decode the beginning of the credential", () => {
      // The property the tail read buys: a credential's leading bytes are never turned into
      // a string at all on this path. Observable only by the answer, which is what it is.
      const mask = maskCredential(bytes(`prefix-that-should-never-appear-${"-".repeat(64)}Xq4A`));

      expect(mask).toBe("••••Xq4A");
      expect(mask).not.toContain("prefix");
    });
  });
});
