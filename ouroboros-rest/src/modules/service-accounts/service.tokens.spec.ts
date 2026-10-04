import {
  hashServiceToken,
  isServiceTokenShape,
  maskServiceToken,
  mintServiceToken,
  SERVICE_TOKEN_PATTERN,
} from "./service.tokens";

/**
 * Minting, hashing and masking a service token (#485).
 */

describe("a minted token", () => {
  it("is the prefix and 43 base64url characters — 32 random bytes", () => {
    expect(mintServiceToken().value).toMatch(SERVICE_TOKEN_PATTERN);
  });

  it("is different every time", () => {
    expect(mintServiceToken().value).not.toBe(mintServiceToken().value);
  });

  it("carries its hash and its hint, and neither contains the secret", () => {
    const token = mintServiceToken();
    const secret = token.value.slice("orb_svc_".length);

    expect(token.hash).toBe(hashServiceToken(token.value));
    expect(token.hash).not.toContain(secret);
    expect(token.hint).toBe(maskServiceToken(token.value));
    expect(token.hint).not.toContain(secret.slice(0, -4));
  });
});

describe("hashing", () => {
  it("is SHA-256, lower-case hex, and deterministic — it is the lookup key", () => {
    expect(hashServiceToken("orb_svc_x")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashServiceToken("orb_svc_x")).toBe(hashServiceToken("orb_svc_x"));
    expect(hashServiceToken("orb_svc_x")).not.toBe(hashServiceToken("orb_svc_y"));
  });
});

describe("masking", () => {
  it("shows the prefix, four bullets and the last four characters", () => {
    expect(maskServiceToken(`orb_svc_${"A".repeat(39)}ab12`)).toBe("orb_svc_••••ab12");
  });
});

describe("shape", () => {
  it("accepts a real token and refuses anything else before a query is spent", () => {
    expect(isServiceTokenShape(mintServiceToken().value)).toBe(true);
    expect(isServiceTokenShape("orb_svc_short")).toBe(false);
    expect(isServiceTokenShape(`orb_svc_${"!".repeat(43)}`)).toBe(false);
  });
});
