/**
 * Every code the authentication surface can answer with, and the errors that carry them.
 *
 * Same arrangement as `tenancy.errors.ts`, for the same reason: a code is only meaningful
 * beside the operation that produces it, `openapi.yaml` publishes the two together, and
 * this file is what makes the string in the document and the string in the answer one
 * constant rather than two.
 *
 * One rule shapes all of it. **A failed sign-in says as little as it truthfully can.** The
 * caller is a browser that either holds a session this service will honour or does not, and
 * the difference between "expired", "signed with a key we have rotated" and "you made this
 * up" is information only the third caller wants. So the code below is coarse on purpose,
 * and the message tells a person what to *do* — sign in — rather than what went wrong
 * inside.
 *
 * **Three codes left with #33's OAuth flow.** `oauth_handshake_invalid`, `github_unavailable`
 * and `github_email_unavailable` were `oauth.ts`'s and `github.ts`'s, and
 * [#702](https://github.com/NobuData/ouroboros/issues/702) deleted all three files
 * together. BetterAuth reports its own failures its own way — a redirect to
 * `/api/auth/error` with the reason in the query string, rather than this service's error
 * envelope — so they were removed rather than renamed: a code in this catalogue that no
 * route can answer with is a contract entry `openapi.yaml` publishes and nothing honours.
 */

import { ForbiddenError, UnauthenticatedError, type ErrorDetails } from "../errors/error.envelope";

/**
 * The codes, as one object.
 *
 * `as const` so each value is its own literal type, and so `auth.errors.spec.ts` can check
 * the specification's copy against these rather than against a string typed twice.
 */
export const AUTH_ERRORS = {
  /** No session, or one this service will not honour. The global guard's answer. */
  unauthenticated: "unauthenticated",
  /**
   * Signed in, but the account is held until an application administrator approves it
   * (account approval). `403`. The UI sends the person to `/account-pending`.
   */
  accountPendingApproval: "account_pending_approval",
  /** Signed in, but an application administrator denied the account. `403`. */
  accountDenied: "account_denied",
  /** A route only an application administrator (`OURO_APP_ADMIN_EMAILS`) may call. `403`. */
  appAdminRequired: "app_admin_required",
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
 * A signed-in person whose account is waiting for approval.
 *
 * Raised by the global guard on every route a held account may not reach. The message is the
 * waiting page's own sentence, so a client that renders it verbatim says the right thing.
 *
 * @returns A `403` `account_pending_approval`.
 */
export function accountPendingApproval(): ForbiddenError {
  return new ForbiddenError(
    AUTH_ERRORS.accountPendingApproval,
    "Your account is waiting for approval. An administrator has been asked.",
  );
}

/**
 * A signed-in person whose account an administrator denied.
 *
 * @returns A `403` `account_denied`.
 */
export function accountDenied(): ForbiddenError {
  return new ForbiddenError(
    AUTH_ERRORS.accountDenied,
    "Your account was not approved. Contact the administrator.",
  );
}

/**
 * A caller who is not an application administrator, on a route only one may call.
 *
 * @returns A `403` `app_admin_required`.
 */
export function appAdminRequired(): ForbiddenError {
  return new ForbiddenError(
    AUTH_ERRORS.appAdminRequired,
    "Only an application administrator may do this.",
  );
}
