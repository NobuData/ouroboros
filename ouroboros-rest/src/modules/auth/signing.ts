/**
 * The signed token every cookie this service sets is made of.
 *
 * Two cookies need the same guarantee — the session (`session.ts`) and the OAuth
 * handshake (`oauth.ts`) — and the guarantee is narrow: *this service wrote this value,
 * and it has not been edited since*. Not confidentiality. The payloads are a user id and a
 * random string, both of which the browser holding them is entitled to know, so encrypting
 * them would buy nothing and hide the one thing worth being able to read in a bug report.
 *
 * The shape is `<payload>.<signature>`, both base64url:
 *
 * ```
 * eyJzdWIiOiI5ZjFjMGE1ZS…IsImlhdCI6MTc3NTg5NDQyM30.q1lD2c1Vn0m-8sVQZ2h9…
 * ```
 *
 * Four decisions, each of them the kind that is only right once:
 *
 *   * **HMAC-SHA256, not a hash of secret+payload.** A plain hash is length-extendable;
 *     an HMAC is the construction that is not, and `node:crypto` has it.
 *   * **The comparison is constant time.** `timingSafeEqual` rather than `===`, because a
 *     comparison that returns early leaks how much of a forged signature was right, and
 *     an attacker who can measure that can build the rest of it one byte at a time. This
 *     is the whole reason the check is here rather than written at each of the two call
 *     sites.
 *   * **The signature is verified before the payload is parsed.** `JSON.parse` on an
 *     unauthenticated string is a parser reachable by anyone with a browser; verifying
 *     first means the only bytes it ever sees are bytes this service produced.
 *   * **Age is part of verification, not of reading.** Every payload carries `iat`, and
 *     {@link readToken} refuses a token older than the caller's maximum — so "expired" is
 *     answered by the same function that answers "forged", and a caller cannot forget to
 *     ask the second question.
 *
 * A stateless token cannot be revoked before it expires: signing out clears the cookie in
 * the browser, and a copy taken beforehand stays valid until `iat` ages out. That is the
 * MVP trade the issue names, and the revocation story — a `sessions` table, or a
 * per-user generation counter the signature covers — is recorded with the security
 * baseline, [#38](https://github.com/NobuData/ouroboros/issues/38). The mitigation until
 * then is the maximum age, which is why it is not optional here.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/** What separates the payload from its signature. Absent from base64url's alphabet. */
export const TOKEN_SEPARATOR = ".";

/** The MAC this module signs with. */
export const SIGNATURE_ALGORITHM = "sha256";

/**
 * What every payload carries, whatever else it carries.
 *
 * `iat` — "issued at" — is seconds since the epoch, matching the JWT field of the same
 * name. Seconds rather than milliseconds because the value is only ever compared against a
 * maximum age measured in hours, and a shorter number is a shorter cookie.
 */
export interface Issued {
  /** When this token was signed, in seconds since the epoch. */
  iat: number;
}

/**
 * Seconds since the epoch.
 *
 * @param now - The instant to read. Passed in rather than reached for, so that every
 *   expiry test in this module is a call with a number in it rather than a fake clock.
 * @returns Whole seconds, rounded down.
 */
export function epochSeconds(now: Date): number {
  return Math.floor(now.getTime() / 1000);
}

/**
 * The signature for one payload.
 *
 * @param body - The encoded payload, exactly as it appears in the token. Signing the
 *   *encoded* form rather than the object is what makes verification a byte comparison
 *   over what actually arrived, with no re-serialisation in between that could differ.
 * @param secret - `OURO_SESSION_SECRET`.
 * @returns The MAC, base64url.
 */
function signatureFor(body: string, secret: string): string {
  return createHmac(SIGNATURE_ALGORITHM, secret).update(body).digest("base64url");
}

/**
 * Are these two signatures the same, without saying how far they matched?
 *
 * @param candidate - The signature that arrived on the request.
 * @param expected - The signature this service computed.
 * @returns Whether they are equal. A length mismatch is answered `false` rather than
 *   thrown: `timingSafeEqual` refuses buffers of different lengths, and a forged token of
 *   the wrong length is an ordinary rejection, not an error.
 */
function signaturesMatch(candidate: string, expected: string): boolean {
  const left = Buffer.from(candidate, "utf8");
  const right = Buffer.from(expected, "utf8");

  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Sign a payload into a token.
 *
 * @param payload - What the token carries. Serialised as JSON, so it must hold nothing a
 *   `JSON.stringify` would drop or throw on — every caller in this module passes a flat
 *   object of strings and numbers.
 * @param secret - `OURO_SESSION_SECRET`. Rotating it invalidates every token in the wild,
 *   which is the documented way to end every session at once.
 * @returns The token, ready to be a cookie value.
 */
export function signToken<T extends Issued>(payload: T, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");

  return `${body}${TOKEN_SEPARATOR}${signatureFor(body, secret)}`;
}

/** What {@link readToken} needs to know beyond the token itself. */
export interface TokenTerms {
  /** The signing key the token must verify against. */
  secret: string;
  /** How old a token may be, in seconds, before it is refused however valid its signature. */
  maxAgeSeconds: number;
  /** The instant to measure that age from. */
  now: Date;
}

/**
 * Read a token this service signed, or answer that it cannot.
 *
 * @param token - The cookie value, or `undefined` when the cookie was not sent at all —
 *   which is the ordinary case for a browser that has never signed in, and is why this
 *   accepts one rather than making every caller check first.
 * @param terms - The secret, the maximum age, and now.
 * @param accepts - A predicate that says whether the decoded payload is the shape this
 *   caller expects. Required rather than optional: a valid signature proves this service
 *   wrote the bytes, and nothing more — a *session* cookie replayed where an OAuth
 *   handshake cookie is expected carries a real signature and the wrong fields, and
 *   without this that would be a `undefined` field read somewhere downstream instead of a
 *   rejection here.
 * @returns The payload, or `undefined` when the token is absent, malformed, unsigned,
 *   signed with a different key, older than `maxAgeSeconds`, or not the expected shape.
 *   One return value for every failure, deliberately: the caller answers `401` to all of
 *   them, and a richer result would be an invitation to tell whoever asked which of those
 *   it was.
 */
export function readToken<T extends Issued>(
  token: string | undefined,
  terms: TokenTerms,
  accepts: (payload: Issued) => payload is T,
): T | undefined {
  if (token === undefined) {
    return undefined;
  }

  const separator = token.indexOf(TOKEN_SEPARATOR);
  if (separator <= 0 || separator === token.length - 1) {
    return undefined;
  }

  const body = token.slice(0, separator);
  const signature = token.slice(separator + 1);

  if (!signaturesMatch(signature, signatureFor(body, terms.secret))) {
    return undefined;
  }

  // Only now, with the bytes proved to be this service's own, is a parser pointed at them.
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }

  if (!isIssued(payload) || !accepts(payload)) {
    return undefined;
  }

  const age = epochSeconds(terms.now) - payload.iat;

  // A negative age is a token issued in the future: a clock that moved backwards, or a
  // signing key shared with a host whose clock is wrong. Refused rather than treated as
  // fresh, because "issued in the future" is also what an unbounded lifetime looks like.
  return age >= 0 && age <= terms.maxAgeSeconds ? payload : undefined;
}

/**
 * Does this decoded value carry an issue time?
 *
 * @param payload - Whatever `JSON.parse` produced.
 * @returns Whether it is an object with a finite numeric `iat`. Checked before the
 *   caller's own predicate so every predicate can assume it.
 */
function isIssued(payload: unknown): payload is Issued {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "iat" in payload &&
    typeof (payload as Issued).iat === "number" &&
    Number.isFinite((payload as Issued).iat)
  );
}
