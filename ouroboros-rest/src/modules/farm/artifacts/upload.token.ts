/**
 * The single-use, job-scoped upload token (#330).
 *
 * Minted with each `job.offer`, sent once in it, and stored only as its SHA-256
 * (`build_job_artifact_uploads.token_hash`). Thirty-two random bytes, so the hash needs no salt and
 * no stretching: there is nothing to guess.
 *
 * ```
 * ouro_upl_<43 base64url characters>
 * ```
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** What every upload token begins with, so one found in a log is recognisable for what it is. */
export const UPLOAD_TOKEN_PREFIX = "ouro_upl_";

/** Random bytes behind a token. */
const TOKEN_BYTES = 32;

/** A minted token: the value, sent once, and the hash, stored. */
export interface MintedUploadToken {
  /** The token. Never stored, never logged. */
  readonly token: string;
  /** Its SHA-256, lower-case hex — what the ledger keeps. */
  readonly hash: string;
}

/**
 * Mint a token.
 *
 * @returns The token and its hash.
 */
export function mintUploadToken(): MintedUploadToken {
  const token = `${UPLOAD_TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString("base64url")}`;

  return { token, hash: hashUploadToken(token) };
}

/**
 * The hash the ledger keeps for a token.
 *
 * @param token - The token.
 * @returns SHA-256, lower-case hex.
 */
export function hashUploadToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Whether a presented token is the one a ledger holds — compared in constant time over the two
 * fixed-length digests, so neither the token's length nor where it differs is observable.
 *
 * @param storedHash - `token_hash`.
 * @param presented - The token from the request, or undefined when it carried none.
 * @returns True when they match.
 */
export function uploadTokenMatches(storedHash: string, presented: string | undefined): boolean {
  const expected = Buffer.from(storedHash, "hex");
  const actual = createHash("sha256")
    .update(presented ?? "", "utf8")
    .digest();

  return (
    expected.length === actual.length &&
    timingSafeEqual(expected, actual) &&
    presented !== undefined
  );
}

/**
 * The token an `Authorization: Bearer <token>` header carries.
 *
 * @param header - The header's value, as the adapter gave it.
 * @returns The token, or undefined when the header is absent or not a bearer credential.
 */
export function bearerToken(header: unknown): string | undefined {
  if (typeof header !== "string") return undefined;

  const match = /^Bearer ([A-Za-z0-9._~-]{1,256})$/.exec(header);
  return match?.[1];
}
