import { createHmac } from "node:crypto";

import {
  ACTION_TOKEN_KEY_BYTES,
  hashActionToken,
  mintActionToken,
  newKey,
  newKeyRef,
  parseActionToken,
} from "./action-token.codec";

describe("the action token codec (#463)", () => {
  it("mints key refs in V096's hash_key_ref grammar", () => {
    const keyRef = newKeyRef();

    expect(keyRef).toMatch(/^act\.[0-9a-f]{16}$/);
    expect(keyRef).toMatch(/^[a-z0-9][a-z0-9._:-]{0,127}$/);
    expect(newKeyRef()).not.toBe(keyRef);
  });

  it("mints 32-byte keys", () => {
    expect(newKey()).toHaveLength(ACTION_TOKEN_KEY_BYTES);
  });

  it("mints a token that carries its key id and 256 random bits", () => {
    const keyRef = "act.0123456789abcdef";
    const token = mintActionToken(keyRef);

    expect(token).toMatch(/^ouro_act_0123456789abcdef_[A-Za-z0-9_-]{43}$/);
    expect(mintActionToken(keyRef)).not.toBe(token);
  });

  it("refuses a key ref it did not mint", () => {
    expect(() => mintActionToken("vault:other")).toThrow(RangeError);
  });

  it("parses a token back to its key ref", () => {
    const token = mintActionToken("act.fedcba9876543210");

    expect(parseActionToken(token)).toEqual({ token, keyRef: "act.fedcba9876543210" });
  });

  it.each([
    ["a non-string", 42],
    ["an empty string", ""],
    ["an unsubscribe token", `ouro_unsub_${"a".repeat(43)}`],
    ["a short secret", `ouro_act_0123456789abcdef_${"a".repeat(42)}`],
    ["an upper-case key id", `ouro_act_0123456789ABCDEF_${"a".repeat(43)}`],
    ["a trailing newline", `ouro_act_0123456789abcdef_${"a".repeat(43)}\n`],
  ])("reads %s as no token at all", (_label, value) => {
    expect(parseActionToken(value)).toBeUndefined();
  });

  it("hashes with HMAC-SHA256 under the key, as 64 hex — never the token itself", () => {
    const key = Buffer.alloc(32, 7);
    const token = mintActionToken("act.0123456789abcdef");
    const hash = hashActionToken(key, token);

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(createHmac("sha256", key).update(token).digest("hex"));
    expect(hash).not.toContain(token);
    expect(hashActionToken(Buffer.alloc(32, 8), token)).not.toBe(hash);
  });
});
