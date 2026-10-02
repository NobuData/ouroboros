import {
  UNSUBSCRIBE_TOKEN_PREFIX,
  hashUnsubscribeToken,
  isUnsubscribeToken,
  mintUnsubscribeToken,
} from "./digest.token";

describe("the unsubscribe token", () => {
  it("is minted with its prefix, 256 bits of randomness, and the hash the audit keeps", () => {
    const { token, hash } = mintUnsubscribeToken();

    expect(token.startsWith(UNSUBSCRIBE_TOKEN_PREFIX)).toBe(true);
    expect(Buffer.from(token.slice(UNSUBSCRIBE_TOKEN_PREFIX.length), "base64url")).toHaveLength(32);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashUnsubscribeToken(token));
    expect(isUnsubscribeToken(token)).toBe(true);
  });

  it("is different every time, and so is its hash", () => {
    const tokens = Array.from({ length: 50 }, () => mintUnsubscribeToken());

    expect(new Set(tokens.map((minted) => minted.token)).size).toBe(50);
    expect(new Set(tokens.map((minted) => minted.hash)).size).toBe(50);
  });

  it("never stores the token: the hash does not contain it", () => {
    const { token, hash } = mintUnsubscribeToken();

    expect(hash).not.toContain(token.slice(UNSUBSCRIBE_TOKEN_PREFIX.length));
  });

  it.each([
    undefined,
    null,
    42,
    ["ouro_unsub_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"],
    "",
    "{token}",
    "ouro_unsub_",
    "ouro_unsub_short",
    "ouro_upl_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "ouro_unsub_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "ouro_unsub_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/",
    " ouro_unsub_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  ])("refuses %p by shape, before anything is looked up", (value) => {
    expect(isUnsubscribeToken(value)).toBe(false);
  });
});
