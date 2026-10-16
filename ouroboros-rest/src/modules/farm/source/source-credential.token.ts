/**
 * The single-use ticket a build runner redeems for its checkout's git credential (AG.7,
 * [#991](https://github.com/NobuData/ouroboros/issues/991), decision **L9**) — minted,
 * hashed and matched exactly as the artifact upload token is (`../artifacts/upload.token.ts`,
 * #330): 32 random bytes under a prefix that says what it is, a SHA-256 in the ledger, and a
 * constant-time comparison at redemption.
 *
 * The ticket is not the credential. It travels once, in the `job.offer`, and buys one call to
 * `POST /api/v1/farm/jobs/{id}/source-credential`; the credential it answers never leaves
 * the request that opened it.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** The prefix every ticket carries, so one in a log is recognised for what it is. */
export const SOURCE_TICKET_PREFIX = "ouro_src_";

/** Random bytes under the prefix. */
const TICKET_BYTES = 32;

/** A freshly minted ticket and the hash the ledger keeps. */
export interface MintedSourceTicket {
  /** The ticket. Never stored, never logged. */
  readonly token: string;
  /** Its SHA-256, lower-case hex — what the ledger keeps. */
  readonly hash: string;
}

/**
 * Mint a ticket.
 *
 * @returns The ticket and its hash.
 */
export function mintSourceTicket(): MintedSourceTicket {
  const token = `${SOURCE_TICKET_PREFIX}${randomBytes(TICKET_BYTES).toString("base64url")}`;

  return { token, hash: hashSourceTicket(token) };
}

/**
 * The hash the ledger keeps for a ticket.
 *
 * @param token - The ticket.
 * @returns Its SHA-256, lower-case hex.
 */
export function hashSourceTicket(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Whether a presented ticket is the one the ledger hashed — compared in constant time, so the
 * answer's timing says nothing about how many bytes matched.
 *
 * @param storedHash - The ledger's hash.
 * @param presented - The bearer the request carried, or `undefined` for none.
 * @returns Whether it matches.
 */
export function sourceTicketMatches(storedHash: string, presented: string | undefined): boolean {
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
 * The bearer a request's `Authorization` header carries, in the ticket's own alphabet.
 *
 * @param header - The header's value, whatever arrived.
 * @returns The bearer, or `undefined` for anything that is not `Bearer <ticket>`.
 */
export function bearerTicket(header: unknown): string | undefined {
  if (typeof header !== "string") return undefined;

  const match = /^Bearer ([A-Za-z0-9._~-]{1,256})$/.exec(header);
  return match?.[1];
}
