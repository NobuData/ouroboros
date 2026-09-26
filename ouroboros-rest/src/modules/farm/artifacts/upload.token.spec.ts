import {
  bearerToken,
  hashUploadToken,
  mintUploadToken,
  UPLOAD_TOKEN_PREFIX,
  uploadTokenMatches,
} from "./upload.token";

/** The single-use upload token (#330): minted, hashed, compared, and read off a header. */

describe("a minted upload token", () => {
  it("is recognisable, header-safe, and unique", () => {
    const first = mintUploadToken();
    const second = mintUploadToken();

    expect(first.token).toMatch(/^ouro_upl_[A-Za-z0-9_-]{43}$/);
    expect(first.token.startsWith(UPLOAD_TOKEN_PREFIX)).toBe(true);
    expect(first.token).not.toBe(second.token);
  });

  it("travels with its hash, which is what the ledger keeps — V060's token_hash shape", () => {
    const { token, hash } = mintUploadToken();

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashUploadToken(token));
    expect(hash).not.toContain(token);
  });
});

describe("comparing a presented token", () => {
  const { token, hash } = mintUploadToken();

  it("matches the token the hash was minted from", () => {
    expect(uploadTokenMatches(hash, token)).toBe(true);
  });

  it("refuses another token, a prefix of it, nothing at all and the empty string", () => {
    expect(uploadTokenMatches(hash, mintUploadToken().token)).toBe(false);
    expect(uploadTokenMatches(hash, token.slice(0, -1))).toBe(false);
    expect(uploadTokenMatches(hash, undefined)).toBe(false);
    expect(uploadTokenMatches(hashUploadToken(""), undefined)).toBe(false);
  });
});

describe("reading the Authorization header", () => {
  it("takes the token from a bearer credential", () => {
    expect(bearerToken("Bearer ouro_upl_abc")).toBe("ouro_upl_abc");
  });

  it.each([
    undefined,
    "",
    "Basic abc",
    "Bearer",
    "Bearer a b",
    "bearer ouro_upl_abc",
    ["Bearer x"],
  ])("finds none in %j", (header) => {
    expect(bearerToken(header)).toBeUndefined();
  });
});
