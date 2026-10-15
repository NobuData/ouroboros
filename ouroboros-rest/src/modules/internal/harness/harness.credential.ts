/**
 * The run-scoped credential a stage harness holds — DH.2
 * ([#1303](https://github.com/NobuData/ouroboros/issues/1303)).
 *
 * ```
 * control plane ── mint {run, stage, alias, attempt} ──▶ ouro_hrn_<43 chars>   shown once
 * harness ── ANTHROPIC_API_KEY=ouro_hrn_… ──▶ facade ── sha-256 ──▶ harness_credentials row
 * ```
 *
 * It is the only secret the engine holds for model calls, and it is useless outside the
 * internal network: it names no provider, opens no key, and buys exactly one alias for one
 * stage of one run, for two hours at most, until the stage ends and it is revoked.
 *
 * Only the sha-256 of the token is stored. A token is 32 random bytes, so a hash needs no salt
 * or stretching: there is nothing to guess.
 */

import { createHash, randomBytes } from "node:crypto";

/** What every token starts with — recognisable in a log or a leaked file. */
export const HARNESS_TOKEN_PREFIX = "ouro_hrn_";

/** How long a credential lives, milliseconds: two hours, a fixed bound (decision of #1303). */
export const HARNESS_CREDENTIAL_TTL_MS = 2 * 60 * 60 * 1000;

/** A token's shape: the prefix and 32 bytes of base64url. */
const TOKEN_PATTERN = /^ouro_hrn_[A-Za-z0-9_-]{43}$/;

/**
 * A fresh token.
 *
 * @returns `ouro_hrn_` and 32 random bytes, base64url.
 */
export function mintToken(): string {
  return `${HARNESS_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

/**
 * What is stored for a token.
 *
 * @param token - The token.
 * @returns Its sha-256, 32 bytes.
 */
export function tokenHash(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

/**
 * The token a harness request presents, if it presents one that could be ours.
 *
 * The Claude Agent SDK sends its `ANTHROPIC_API_KEY` as `x-api-key`; an `ANTHROPIC_AUTH_TOKEN`
 * arrives as `Authorization: Bearer`. Either is read; a header sent twice is neither.
 *
 * @param headers - The request headers, lower-cased.
 * @returns The token, or null when none is presented or it is not shaped like one.
 */
export function presentedToken(headers: Readonly<Record<string, unknown>>): string | null {
  const apiKey = headers["x-api-key"];
  const authorization = headers.authorization;
  const bearer =
    typeof authorization === "string" && authorization.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : null;
  const candidate = typeof apiKey === "string" ? apiKey : bearer;

  return candidate !== null && TOKEN_PATTERN.test(candidate) ? candidate : null;
}

/** What minting answers. The token appears here and nowhere else, ever. */
export interface MintedCredential {
  readonly id: string;
  readonly token: string;
  readonly run: string;
  readonly stage: string;
  readonly alias: string;
  readonly attempt: number;
  readonly expiresAt: string;
}

/** A credential about to be stored: what is kept, and what is shown once. */
export interface Issuance {
  /** What the database keeps — the sha-256 of the token. */
  readonly digest: Buffer;
  readonly expiresAt: Date;
  /**
   * The answer to the minting call, the only place the token appears.
   *
   * @param bound - The stored row's id and what it is bound to.
   * @returns The minted credential.
   */
  minted(bound: Omit<MintedCredential, "token" | "expiresAt">): MintedCredential;
}

/**
 * Issue a credential: a fresh token, its digest, its expiry.
 *
 * The token stays inside the returned closure, so the service that stores the digest never
 * holds a variable naming it.
 *
 * @param now - When it is issued.
 * @returns The issuance.
 */
export function issue(now: Date): Issuance {
  const token = mintToken();
  const expiresAt = new Date(now.getTime() + HARNESS_CREDENTIAL_TTL_MS);

  return {
    digest: tokenHash(token),
    expiresAt,
    minted: (bound) => ({ ...bound, token, expiresAt: expiresAt.toISOString() }),
  };
}

/**
 * The digest of the token a request presents, ready to look up.
 *
 * @param headers - The request headers, lower-cased.
 * @returns The digest, or null when no token-shaped credential is presented.
 */
export function digestOfPresented(headers: Readonly<Record<string, unknown>>): Buffer | null {
  const presented = presentedToken(headers);

  return presented === null ? null : tokenHash(presented);
}
