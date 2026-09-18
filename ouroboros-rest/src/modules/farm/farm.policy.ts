/**
 * Every number this module has an opinion about, in one file.
 *
 * AH.2 ([#250](https://github.com/NobuData/ouroboros/issues/250)). A certificate lifetime, a
 * token's longest TTL and the size of a secret are the kind of constants that get written
 * three times and then disagree — once in a service, once in a DTO's `@Max()`, and once in
 * the sentence a test asserts. Here they are written once and the DTO, the service and the
 * spec all read them, so *how long is a runner certificate good for* has one answer and
 * changing it is one edit.
 *
 * Each one carries the reasoning for the value rather than the value alone, because the
 * value is the easy part.
 */

/** Milliseconds in a second, a minute, an hour and a day — named so the arithmetic below reads. */
const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * How long a runner's certificate is valid.
 *
 * Ninety days, and the number is a compromise between two costs that pull opposite ways. A
 * shorter life means a revocation that somehow does not reach the gateway still expires
 * soon; a longer one means a fleet of machines that lose connectivity for a fortnight come
 * back able to work. Ninety days is what the public web settled on for the same trade, and
 * it is comfortably longer than any outage a build farm survives — while
 * {@link RENEWAL_LEAD_MS} makes a runner start renewing at thirty days remaining, so a
 * certificate has three chances to be replaced before anybody notices.
 *
 * It is not the security boundary. Revocation is, and it is checked at every handshake.
 */
export const CERTIFICATE_LIFETIME_MS = 90 * DAY_MS;

/**
 * How long the farm CA itself is valid.
 *
 * Ten years, because a CA expiring is a fleet-wide outage with no partial failure to warn
 * anybody first — every runner stops at once — and because rotating one is a deliberate
 * operation (issue a new authority, re-certify, retire the old) rather than something a
 * clock should force at an unpredictable moment. A shorter CA lifetime buys nothing here:
 * the key is sealed by AD.1 and its compromise is answered by replacing the authority, not
 * by having planned to replace it soon anyway.
 */
export const AUTHORITY_LIFETIME_MS = 10 * 365 * DAY_MS;

/**
 * How early a runner should ask for a new certificate.
 *
 * Thirty days before expiry — a third of the lifetime. Published in the enrollment response
 * so the agent does not have to hard-code a fraction this service might change, which is the
 * same reason `v1.json` publishes the protocol's limits as numbers.
 */
export const RENEWAL_LEAD_MS = 30 * DAY_MS;

/**
 * How far in the past a certificate's validity begins.
 *
 * Five minutes. Not a grace for a slow request — it is for the clock on the runner, which is
 * a machine the control plane does not administer and which may be a few seconds or a few
 * minutes out. A certificate that is not yet valid fails a handshake in a way whose error
 * message points at TLS rather than at a clock, and five minutes costs nothing.
 */
export const CLOCK_SKEW_MS = 5 * MINUTE_MS;

/**
 * The longest life an enrollment token may be minted with.
 *
 * Thirty days. A token is a bearer secret that travels on a command line and into a shell
 * history, so its whole design is that it is short-lived and scoped; a token good for a year
 * is a password with extra steps. Thirty days is long enough to cover installing a rack over
 * a maintenance window and an ordinary amount of procurement delay.
 */
export const MAX_TOKEN_TTL_MS = 30 * DAY_MS;

/** The shortest — a minute, below which a token would expire before anybody could paste it. */
export const MIN_TOKEN_TTL_MS = MINUTE_MS;

/** The TTL a mint request that does not name one gets. A day, which is the mockup's `ttl 24h`. */
export const DEFAULT_TOKEN_TTL_MS = DAY_MS;

/**
 * The most runners one token may enrol.
 *
 * The schema requires at least one; this is the other end. A hundred is a rack and then
 * some, and the bound exists for the reason `enrollment_tokens.max_uses`' own comment gives:
 * an unlimited token is a password.
 */
export const MAX_TOKEN_USES = 100;

/**
 * How many random bytes an enrollment token's secret carries.
 *
 * Thirty-two — 256 bits, encoded base64url into the 43 characters after the prefix. The
 * secret is never hashed into a lookup key and never guessed at scale, because a presented
 * token names its own row; the width is what makes the comparison that follows worth making.
 */
export const TOKEN_SECRET_BYTES = 32;

/** The same, for the bearer fallback's long-lived secret. Same width, same argument. */
export const BEARER_SECRET_BYTES = 32;

/**
 * The window a certificate issued now covers.
 *
 * @param at - Now.
 * @returns Not-before, backdated by the skew allowance, and not-after.
 */
export function certificateWindow(at: Date): { notBefore: Date; notAfter: Date } {
  return {
    notBefore: new Date(at.getTime() - CLOCK_SKEW_MS),
    notAfter: new Date(at.getTime() + CERTIFICATE_LIFETIME_MS),
  };
}

/**
 * The window a newly created authority covers.
 *
 * @param at - Now.
 * @returns Not-before, backdated by the skew allowance, and not-after.
 */
export function authorityWindow(at: Date): { notBefore: Date; notAfter: Date } {
  return {
    notBefore: new Date(at.getTime() - CLOCK_SKEW_MS),
    notAfter: new Date(at.getTime() + AUTHORITY_LIFETIME_MS),
  };
}
