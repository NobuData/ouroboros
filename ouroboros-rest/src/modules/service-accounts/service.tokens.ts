/**
 * Service tokens — minting, hashing and masking ([#485](https://github.com/NobuData/ouroboros/issues/485)).
 *
 * A token is `orb_svc_` followed by 32 random bytes in base64url. It is handed to the operator
 * **once** — in the response that created or rotated it — and never again: the database holds
 * its SHA-256 (`token_hash`) and a masked hint sealed under the workspace DEK, and nothing that
 * could give the token back.
 *
 * SHA-256 rather than a slow password hash on purpose. The token is 256 bits of randomness, not
 * something a person chose, so there is no dictionary to slow down; and the hash is the lookup
 * key on every service request, so it must be cheap and deterministic.
 */

import { createHash, randomBytes } from "node:crypto";

import { SERVICE_TOKEN_PREFIX } from "../auth/service.principal";

/** How many random bytes a token carries. */
export const SERVICE_TOKEN_BYTES = 32;

/** The bullet a mask is drawn with — U+2022, as the farm's and providers' masks use. */
export const MASK_GLYPH = "•";

/** How many trailing characters a mask shows, so two tokens in a list are distinguishable. */
export const MASK_SUFFIX = 4;

/** A token's full shape: the prefix and 43 base64url characters. */
export const SERVICE_TOKEN_PATTERN = /^orb_svc_[A-Za-z0-9_-]{43}$/;

/** A freshly minted token. */
export interface MintedServiceToken {
  /** The whole value. Returned to the operator exactly once; never stored or logged. */
  readonly value: string;
  /** Its SHA-256, lower-case hex — what is stored and looked up. */
  readonly hash: string;
  /** Its masked display form, `orb_svc_••••ab12` — what is sealed and shown thereafter. */
  readonly hint: string;
}

/**
 * Mint a new token.
 *
 * @returns The value (show it once), its hash (store it) and its hint (seal it).
 */
export function mintServiceToken(): MintedServiceToken {
  const value = `${SERVICE_TOKEN_PREFIX}${randomBytes(SERVICE_TOKEN_BYTES).toString("base64url")}`;

  return { value, hash: hashServiceToken(value), hint: maskServiceToken(value) };
}

/**
 * The stored form of a token.
 *
 * @param token - The presented token.
 * @returns Its SHA-256, lower-case hex.
 */
export function hashServiceToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * The display form of a token: the prefix, four bullets, and the last {@link MASK_SUFFIX}
 * characters.
 *
 * @param token - The token.
 * @returns E.g. `orb_svc_••••ab12`.
 */
export function maskServiceToken(token: string): string {
  return `${SERVICE_TOKEN_PREFIX}${MASK_GLYPH.repeat(4)}${token.slice(-MASK_SUFFIX)}`;
}

/**
 * Whether a presented value could be a token at all — checked before any lookup, so a malformed
 * header costs no query.
 *
 * @param token - The presented value.
 * @returns `true` for the prefix followed by 43 base64url characters.
 */
export function isServiceTokenShape(token: string): boolean {
  return SERVICE_TOKEN_PATTERN.test(token);
}
