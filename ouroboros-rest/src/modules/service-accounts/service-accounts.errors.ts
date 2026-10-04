/**
 * The service-account routes' refusals ([#485](https://github.com/NobuData/ouroboros/issues/485)).
 * Authentication and scope refusals are `auth/service.scopes.ts`'s, because the guards raise them.
 */

import { ConflictError, NotFoundError } from "../errors/error.envelope";

/** Every code this module raises. */
export const SERVICE_ACCOUNT_ERRORS = {
  notFound: "service_account_not_found",
  nameTaken: "service_account_name_taken",
  disabled: "service_account_disabled",
} as const;

/**
 * No such service account in this workspace.
 *
 * @param id - The id asked for.
 * @returns A `404`.
 */
export function serviceAccountNotFound(id: string): NotFoundError {
  return new NotFoundError(SERVICE_ACCOUNT_ERRORS.notFound, "No such service account.", { id });
}

/**
 * The workspace already has a service account of this name — names are audit identities.
 *
 * @param name - The name.
 * @returns A `409`.
 */
export function serviceAccountNameTaken(name: string): ConflictError {
  return new ConflictError(
    SERVICE_ACCOUNT_ERRORS.nameTaken,
    `This workspace already has a service account named ${name}.`,
    { name },
  );
}

/**
 * The account was revoked; it cannot be given a new token.
 *
 * @param id - The account.
 * @returns A `409`.
 */
export function serviceAccountDisabled(id: string): ConflictError {
  return new ConflictError(
    SERVICE_ACCOUNT_ERRORS.disabled,
    "This service account was revoked. Create a new one instead.",
    { id },
  );
}
