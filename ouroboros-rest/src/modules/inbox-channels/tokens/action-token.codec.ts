/**
 * The action token's shape and hash (BN.3, [#463](https://github.com/NobuData/ouroboros/issues/463),
 * decision **X5**) — pure.
 *
 * A link in a mail that answers a decision is a bearer credential, so the token is built to be
 * worthless anywhere but in that one mail:
 *
 * ```
 * ouro_act_<key id: 16 hex>_<secret: 32 random bytes, base64url>
 *          └─ finds the workspace's HMAC key (action_token_keys.key_ref = "act.<key id>")
 * stored:  HMAC-SHA256(key, token) — 64 hex in action_tokens.token_hash (V096)
 * ```
 *
 * The key id says *which* key to hash under, nothing more; the secret is 256 bits of randomness.
 * The database holds only the HMAC, and the key is sealed by the vault (V100), so neither a read of
 * the tables nor a leaked key alone yields a working link.
 */

import { createHmac, randomBytes } from "node:crypto";

/** What every action token starts with — it says what the string is to whoever finds one. */
export const ACTION_TOKEN_PREFIX = "ouro_act_";

/** What every key ref minted here starts with (V096's `hash_key_ref` grammar). */
export const ACTION_TOKEN_KEY_REF_PREFIX = "act.";

/** Bytes of randomness in a token's secret: 256 bits. */
const SECRET_BYTES = 32;

/** Bytes of randomness in a key id: 64 bits — an identifier, not a secret. */
const KEY_ID_BYTES = 8;

/** Bytes in an HMAC key. */
export const ACTION_TOKEN_KEY_BYTES = 32;

/** A well-formed token: the prefix, a 16-hex key id, and 43 base64url characters. */
const TOKEN_SHAPE = /^ouro_act_([0-9a-f]{16})_[A-Za-z0-9_-]{43}$/;

/** A token, parsed. */
export interface ParsedActionToken {
  /** The whole token, as presented. */
  readonly token: string;
  /** The key it was hashed under — `act.<key id>`. */
  readonly keyRef: string;
}

/**
 * A fresh key ref for a new workspace key.
 *
 * @returns `act.<16 hex>`.
 */
export function newKeyRef(): string {
  return `${ACTION_TOKEN_KEY_REF_PREFIX}${randomBytes(KEY_ID_BYTES).toString("hex")}`;
}

/**
 * A fresh HMAC key.
 *
 * @returns 32 random bytes.
 */
export function newKey(): Buffer {
  return randomBytes(ACTION_TOKEN_KEY_BYTES);
}

/**
 * Mint a token under a key.
 *
 * @param keyRef - The key's ref, `act.<16 hex>`.
 * @returns The token. Goes into one mail; never stored, never logged.
 * @throws {RangeError} For a key ref this codec did not mint.
 */
export function mintActionToken(keyRef: string): string {
  if (!/^act\.[0-9a-f]{16}$/.test(keyRef)) {
    throw new RangeError(`not an action-token key ref: ${keyRef}`);
  }

  const keyId = keyRef.slice(ACTION_TOKEN_KEY_REF_PREFIX.length);

  return `${ACTION_TOKEN_PREFIX}${keyId}_${randomBytes(SECRET_BYTES).toString("base64url")}`;
}

/**
 * Read a presented value as a token.
 *
 * Asked before any database read: a path segment that is not a token cannot be in the table, so a
 * scanner walking the route costs no query.
 *
 * @param value - Whatever arrived in the path.
 * @returns The token and its key ref, or undefined for anything not shaped like one.
 */
export function parseActionToken(value: unknown): ParsedActionToken | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const match = TOKEN_SHAPE.exec(value);

  return match === null
    ? undefined
    : { token: value, keyRef: `${ACTION_TOKEN_KEY_REF_PREFIX}${match[1] ?? ""}` };
}

/**
 * The hash V096 stores for a token.
 *
 * @param key - The workspace's HMAC key.
 * @param token - The token.
 * @returns HMAC-SHA256, lower-case hex (64 characters).
 */
export function hashActionToken(key: Buffer, token: string): string {
  return createHmac("sha256", key).update(token, "utf8").digest("hex");
}
