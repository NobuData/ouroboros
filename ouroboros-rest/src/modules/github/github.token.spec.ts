import { MASK_ONLY } from "../provider-connections/masking";
import {
  FIXTURE_FINE_GRAINED,
  FIXTURE_LEGACY_TOKEN,
  FIXTURE_MASK,
  FIXTURE_TOKEN,
} from "./github.fixture";
import {
  LONGEST_PREFIX_BYTES,
  MAX_TOKEN_LENGTH,
  MIN_TOKEN_LENGTH,
  TOKEN_PREFIXES,
  isWellFormedToken,
  maskToken,
  tokenPrefix,
} from "./github.token";

/**
 * The two claims this file makes, and they pull in opposite directions.
 *
 * The shape check has to be **loose enough** to admit every token GitHub has issued — the
 * six prefixes and the pre-2021 hex ones — and **tight enough** that the paste errors it
 * exists for cannot pass: a URL, an org name, a token with the newline a terminal copy left
 * on it. Both halves are asserted, because a check that only refuses rubbish and a check that
 * only accepts tokens are different mistakes and each looks fine on its own.
 *
 * The mask has one claim: whatever goes in, what comes out contains the prefix, four bullets
 * and at most the last four characters. The last clause is the one worth a test that reads
 * the output rather than compares it — a mask that is right for the fixture and wrong for a
 * three-character string is a mask nobody would notice was wrong.
 */

describe("recognising a GitHub token", () => {
  it.each([...TOKEN_PREFIXES])("accepts a token prefixed %s", (prefix) => {
    expect(isWellFormedToken(`${prefix}${"a".repeat(MIN_TOKEN_LENGTH)}`)).toBe(true);
  });

  it("accepts the pre-2021 forty-character hex token, which GitHub never invalidated", () => {
    expect(isWellFormedToken(FIXTURE_LEGACY_TOKEN)).toBe(true);
  });

  it.each([
    ["an empty string", ""],
    ["a repository URL", "https://github.com/nobudata/ouroboros"],
    ["an organisation login", "nobudata"],
    ["a bearer header somebody pasted whole", `Bearer ${FIXTURE_TOKEN}`],
    ["hex of the wrong length", "0123456789abcdef"],
    ["hex with a capital, which GitHub's legacy tokens never had", "0123456789ABCDEF".repeat(2)],
  ])("refuses %s", (_case, value) => {
    expect(isWellFormedToken(value)).toBe(false);
  });

  it("refuses a token carrying the newline a terminal copy leaves on the end", () => {
    // The value *is* a token; the whitespace is what makes it unusable. Sent as a header it
    // would be a request GitHub rejects for a reason nobody could see from here — which is
    // why the DTO trims before it validates and this refuses what trimming would not fix.
    expect(isWellFormedToken(`${FIXTURE_TOKEN}\n`)).toBe(false);
  });

  it("refuses whitespace inside the value, which trimming cannot rescue", () => {
    expect(isWellFormedToken(`ghp_abcd efghijklmnopqrstuvwxyz0123456`)).toBe(false);
  });

  it("refuses a prefix on its own — the state a half-finished paste leaves", () => {
    expect(isWellFormedToken("ghp_")).toBe(false);
  });

  it("refuses a value longer than the endpoint will store", () => {
    expect(isWellFormedToken(`ghp_${"a".repeat(MAX_TOKEN_LENGTH)}`)).toBe(false);
  });

  it("finds the fine-grained prefix rather than a shorter one inside it", () => {
    expect(tokenPrefix(FIXTURE_FINE_GRAINED)).toBe("github_pat_");
  });

  it("reports no prefix for a legacy token, which is not the same as refusing it", () => {
    expect(tokenPrefix(FIXTURE_LEGACY_TOKEN)).toBeUndefined();
    expect(isWellFormedToken(FIXTURE_LEGACY_TOKEN)).toBe(true);
  });

  it("reads far enough into a token to see the longest prefix there is", () => {
    expect(LONGEST_PREFIX_BYTES).toBe(Math.max(...TOKEN_PREFIXES.map((each) => each.length)));
    expect(LONGEST_PREFIX_BYTES).toBeGreaterThanOrEqual("github_pat_".length);
  });
});

describe("masking a stored token", () => {
  it("shows the prefix and the last four characters, and nothing between them", () => {
    expect(maskToken(Buffer.from(FIXTURE_TOKEN, "utf8"))).toBe(FIXTURE_MASK);
  });

  it("keeps the fine-grained prefix, because it says which kind of token this is", () => {
    expect(maskToken(Buffer.from(FIXTURE_FINE_GRAINED, "utf8"))).toBe("github_pat_••••6789");
  });

  it("has no prefix to show for a legacy token, and shows the tail anyway", () => {
    expect(maskToken(Buffer.from(FIXTURE_LEGACY_TOKEN, "utf8"))).toBe("••••4567");
  });

  it("degrades to bullets alone rather than showing all of something too short", () => {
    // Not a token any vendor issues — and showing every character of a three-character
    // secret while calling it a mask is the one failure a mask can have.
    expect(maskToken(Buffer.from("abc", "utf8"))).toBe(MASK_ONLY);
  });

  it("never contains more of the token than its prefix and its last four characters", () => {
    const masked = maskToken(Buffer.from(FIXTURE_TOKEN, "utf8"));
    const middle = FIXTURE_TOKEN.slice("ghp_".length, -4);

    expect(masked).not.toContain(middle);
    // Every run of four characters from the hidden middle, not just the whole of it: a mask
    // that leaked six characters would pass the assertion above.
    for (let at = 0; at + 4 <= middle.length; at += 1) {
      expect(masked).not.toContain(middle.slice(at, at + 4));
    }
  });

  it("does not consume the buffer it was given", () => {
    const bytes = Buffer.from(FIXTURE_TOKEN, "utf8");

    maskToken(bytes);

    // The caller still owns it and is still the one that erases it — which matters because
    // the service masks and *then* zeroizes in a `finally`.
    expect(bytes.toString("utf8")).toBe(FIXTURE_TOKEN);
  });
});
