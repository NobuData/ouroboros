/**
 * The unsubscribe token (#440): the one credential in a digest mail.
 *
 * A link that works with no login needs something in it that proves the click came from the
 * mail. That is a random token minted **per send**: the mail carries the token, the send row
 * (`insights_digest_sends.unsubscribe_token_hash`, V084) carries its SHA-256, and the row is
 * written *before* the mail leaves — so a delivered mail always has a link that resolves, and a
 * read of the table gives nobody a link. The shape is `farm/artifacts/upload.token.ts`'s, for
 * the same reasons.
 *
 * All it can do is unsubscribe the one person from the one workspace's digest. It does not
 * expire: a mail read three months later must still be able to stop the next one.
 */

import { createHash, randomBytes } from "node:crypto";

/** What every unsubscribe token starts with — it says what the string is to whoever finds one. */
export const UNSUBSCRIBE_TOKEN_PREFIX = "ouro_unsub_";

/** Bytes of randomness in a token: 256 bits. */
const TOKEN_BYTES = 32;

/** A well-formed token: the prefix and exactly 32 bytes of base64url. */
const TOKEN_SHAPE = /^ouro_unsub_[A-Za-z0-9_-]{43}$/;

/** A freshly minted token and what the send audit keeps of it. */
export interface MintedUnsubscribeToken {
  /** The token. Goes into one mail; never stored, never logged. */
  readonly token: string;
  /** Its SHA-256, lower-case hex. */
  readonly hash: string;
}

/**
 * Mint a token.
 *
 * @returns The token and its hash.
 */
export function mintUnsubscribeToken(): MintedUnsubscribeToken {
  const token = `${UNSUBSCRIBE_TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString("base64url")}`;

  return { token, hash: hashUnsubscribeToken(token) };
}

/**
 * The hash the send audit stores for a token.
 *
 * @param token - The token.
 * @returns SHA-256, lower-case hex.
 */
export function hashUnsubscribeToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Whether a presented value is shaped like a token at all.
 *
 * Asked before any database read: a path segment that is not a token cannot be in the table, so
 * a scanner walking the route costs no query.
 *
 * @param value - Whatever arrived in the path.
 * @returns True for a well-formed token.
 */
export function isUnsubscribeToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_SHAPE.test(value);
}
