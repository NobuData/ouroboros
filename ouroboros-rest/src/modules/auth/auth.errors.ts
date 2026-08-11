/**
 * Every code the authentication surface can answer with, and the errors that carry them.
 *
 * Same arrangement as `tenancy.errors.ts`, for the same reason: a code is only meaningful
 * beside the operation that produces it, `openapi.yaml` publishes the two together, and
 * this file is what makes the string in the document and the string in the answer one
 * constant rather than two.
 *
 * One rule shapes all of it. **A failed sign-in says as little as it truthfully can.** The
 * caller of these routes is a browser that either completed a handshake or did not, and
 * the difference between "your state cookie expired", "your state does not match" and "you
 * fabricated this callback" is information only the third caller wants. So the codes below
 * are coarse on purpose, and the messages tell a person what to *do* — start again — rather
 * than what went wrong inside.
 */

import { UnauthenticatedError, UpstreamError, type ErrorDetails } from "../errors/error.envelope";

/**
 * The codes, as one object.
 *
 * `as const` so each value is its own literal type, and so `auth.errors.spec.ts` can check
 * the specification's copy against these rather than against a string typed twice.
 */
export const AUTH_ERRORS = {
  /** No session, or one this service will not honour. The global guard's answer. */
  unauthenticated: "unauthenticated",
  /** The callback did not come from a handshake this service started. */
  handshakeInvalid: "oauth_handshake_invalid",
  /** GitHub refused the code exchange, or could not be reached. */
  githubUnavailable: "github_unavailable",
  /** GitHub returned no verified address, so there is nobody to be. */
  emailUnavailable: "github_email_unavailable",
} as const;

/** One of {@link AUTH_ERRORS}' values. */
export type AuthErrorCode = (typeof AUTH_ERRORS)[keyof typeof AUTH_ERRORS];

/**
 * `401` — this request is not signed in.
 *
 * @param details - Anything specific. Empty at every call site today, and the parameter is
 *   here so it stays that way deliberately rather than by omission — see this file's
 *   header on what a failed sign-in is allowed to say.
 * @returns The error to throw.
 */
export function unauthenticated(details: ErrorDetails = {}): UnauthenticatedError {
  return new UnauthenticatedError(AUTH_ERRORS.unauthenticated, "Sign in to continue.", details);
}

/**
 * `401` — the callback does not match a handshake this service started.
 *
 * Covers the absent cookie, the expired one, the forged one and the mismatched `state`,
 * all as one answer. That is the CSRF defence working: a callback an attacker composed
 * cannot carry the cookie, and telling them which part was missing is telling them what to
 * fix.
 *
 * @returns The error to throw.
 */
export function handshakeInvalid(): UnauthenticatedError {
  return new UnauthenticatedError(
    AUTH_ERRORS.handshakeInvalid,
    "That sign-in link is no longer valid. Start again from the sign-in page.",
  );
}

/**
 * `502` — GitHub refused the exchange or did not answer.
 *
 * Deliberately not a `500`: nothing in this service is broken, and a client retrying is
 * reasonable. Deliberately not carrying GitHub's own message either — see
 * {@link UpstreamError}.
 *
 * @returns The error to throw.
 */
export function githubUnavailable(): UpstreamError {
  return new UpstreamError(
    AUTH_ERRORS.githubUnavailable,
    "GitHub could not complete the sign-in. Try again in a moment.",
  );
}

/**
 * `502` — GitHub authenticated the person and offered no verified address.
 *
 * `ouroboros.users.email` is `not null` and unique, and it is how a person invited to a
 * tenant before they ever signed in is recognised as that person (V002). An account with
 * every address unverified or hidden cannot be matched to an invitation, and guessing —
 * inventing an address, or accepting an unverified one somebody else may control — is the
 * one failure here that would be silent and permanent.
 *
 * @returns The error to throw.
 */
export function emailUnavailable(): UpstreamError {
  return new UpstreamError(
    AUTH_ERRORS.emailUnavailable,
    "GitHub did not provide a verified email address. Verify an address on GitHub and try again.",
  );
}
