import {
  HARNESS_CREDENTIAL_TTL_MS,
  digestOfPresented,
  issue,
  mintToken,
  presentedToken,
  tokenHash,
} from "./harness.credential";

describe("the harness token", () => {
  it("is the prefix and 32 random bytes, different every time", () => {
    const a = mintToken();

    expect(a).toMatch(/^ouro_hrn_[A-Za-z0-9_-]{43}$/);
    expect(mintToken()).not.toBe(a);
  });

  it("is stored as a 32-byte sha-256, never as itself", () => {
    const token = mintToken();

    expect(tokenHash(token)).toHaveLength(32);
    expect(tokenHash(token).equals(tokenHash(token))).toBe(true);
    expect(tokenHash(token).toString("utf8")).not.toContain(token);
  });
});

describe("the presented token", () => {
  const token = mintToken();

  it("is read from x-api-key, as the SDK sends ANTHROPIC_API_KEY", () => {
    expect(presentedToken({ "x-api-key": token })).toBe(token);
  });

  it("is read from a bearer, as the SDK sends ANTHROPIC_AUTH_TOKEN", () => {
    expect(presentedToken({ authorization: `Bearer ${token}` })).toBe(token);
  });

  it("is nothing for a missing, malformed, provider-shaped or doubled header", () => {
    expect(presentedToken({})).toBeNull();
    expect(presentedToken({ "x-api-key": "ouro_hrn_short" })).toBeNull();
    expect(presentedToken({ "x-api-key": "sk-ant-api03-not-ours" })).toBeNull();
    expect(presentedToken({ "x-api-key": [token, token] })).toBeNull();
  });

  it("is looked up by its digest", () => {
    expect(digestOfPresented({ "x-api-key": token })?.equals(tokenHash(token))).toBe(true);
    expect(digestOfPresented({})).toBeNull();
  });
});

describe("issue", () => {
  it("keeps the digest, expires in two hours, and shows the token only in the minted answer", () => {
    const now = new Date("2026-10-14T09:00:00.000Z");
    const issuance = issue(now);
    const minted = issuance.minted({
      id: "c1",
      run: "r1",
      stage: "implement",
      alias: "coder-max",
      attempt: 2,
    });

    expect(issuance.expiresAt.getTime() - now.getTime()).toBe(HARNESS_CREDENTIAL_TTL_MS);
    expect(HARNESS_CREDENTIAL_TTL_MS).toBe(2 * 60 * 60 * 1000);
    expect(tokenHash(minted.token).equals(issuance.digest)).toBe(true);
    expect(minted).toEqual({
      id: "c1",
      run: "r1",
      stage: "implement",
      alias: "coder-max",
      attempt: 2,
      token: minted.token,
      expiresAt: "2026-10-14T11:00:00.000Z",
    });
  });
});
