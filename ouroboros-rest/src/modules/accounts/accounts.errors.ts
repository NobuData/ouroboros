/**
 * The account-approval admin routes' own refusals.
 *
 * The three codes the global guard and the admin check answer with — `account_pending_approval`,
 * `account_denied`, `app_admin_required` — are the authentication surface's and live in
 * `auth/auth.errors.ts`. These are the ones only an administrator can meet.
 */

import { ConflictError, NotFoundError } from "../errors/error.envelope";

/** Every code this module raises. */
export const ACCOUNTS_ERRORS = {
  accountNotFound: "account_not_found",
  cannotDenyAppAdmin: "cannot_deny_app_admin",
  alreadyPreapproved: "already_preapproved",
  preapprovedEmailNotFound: "preapproved_email_not_found",
} as const;

/**
 * No account with that id.
 *
 * @param userId - The id asked for.
 * @returns A `404` `account_not_found`.
 */
export function accountNotFound(userId: string): NotFoundError {
  return new NotFoundError(ACCOUNTS_ERRORS.accountNotFound, "No such account.", { userId });
}

/**
 * An application administrator's account cannot be denied: `OURO_APP_ADMIN_EMAILS` approves it
 * whatever is stored, so a denial would be a row that says one thing while the guard does another.
 *
 * @param userId - The administrator's account.
 * @returns A `409` `cannot_deny_app_admin`.
 */
export function cannotDenyAppAdmin(userId: string): ConflictError {
  return new ConflictError(
    ACCOUNTS_ERRORS.cannotDenyAppAdmin,
    "An application administrator's account cannot be denied.",
    { userId },
  );
}

/**
 * The address is already on the pre-approved list.
 *
 * @param email - The lower-cased address.
 * @returns A `409` `already_preapproved`.
 */
export function alreadyPreapproved(email: string): ConflictError {
  return new ConflictError(
    ACCOUNTS_ERRORS.alreadyPreapproved,
    "That email is already pre-approved.",
    {
      email,
    },
  );
}

/**
 * The address is not on the pre-approved list.
 *
 * @param email - The lower-cased address.
 * @returns A `404` `preapproved_email_not_found`.
 */
export function preapprovedEmailNotFound(email: string): NotFoundError {
  return new NotFoundError(
    ACCOUNTS_ERRORS.preapprovedEmailNotFound,
    "That email is not pre-approved.",
    { email },
  );
}
