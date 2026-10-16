"use server";

/**
 * What the accounts page submits (account approval): approve, deny, and the pre-approved list.
 *
 * Each action is a POST endpoint anybody can call, so none of them decides who may: the service
 * refuses every one of these routes with `403 app_admin_required` to anyone not listed in
 * `OURO_APP_ADMIN_EMAILS`, and that refusal comes back here as a sentence for the toast. A
 * service refusal is a value, never a throw — the page stays where it is and says why.
 */

import { type AddedPreapprovedEmail, adminAccounts } from "@/app/api/accounts";
import { isApiError } from "@/app/api/errors";

import { type AdminWrite, WRITE_FAILED } from "./admin";

/**
 * Run one write, turning a service refusal into its sentence.
 *
 * @param write The call.
 * @returns The value, or the refusal's message.
 * @throws Anything that is not an `ApiError` — a redirect signal included.
 */
async function written<T>(write: () => Promise<T>): Promise<AdminWrite<T>> {
  try {
    return { ok: true, value: await write() };
  } catch (error) {
    if (!isApiError(error)) throw error;
    return { ok: false, reason: error.message.trim() === "" ? WRITE_FAILED : error.message };
  }
}

/**
 * Approve an account — pending or denied.
 *
 * @param userId The account.
 * @returns Nothing on success, or the refusal.
 */
export async function approveAccount(userId: string): Promise<AdminWrite<null>> {
  return written(async () => {
    await adminAccounts.approve(userId);
    return null;
  });
}

/**
 * Deny a waiting account.
 *
 * @param userId The account.
 * @returns Nothing on success, or the refusal (`409 cannot_deny_app_admin` among them).
 */
export async function denyAccount(userId: string): Promise<AdminWrite<null>> {
  return written(async () => {
    await adminAccounts.deny(userId);
    return null;
  });
}

/**
 * Pre-approve an email. The service approves a waiting account with that email at once, and
 * says so in `approvedAccount`.
 *
 * @param email The email, as typed — the service validates and lower-cases it.
 * @param note An optional note; empty means none.
 * @returns The entry added (with the account it approved, or `null`), or the refusal
 *   (`409 already_preapproved` among them).
 */
export async function addPreapprovedEmail(
  email: string,
  note: string,
): Promise<AdminWrite<AddedPreapprovedEmail>> {
  const trimmed = note.trim();

  return written(() =>
    adminAccounts.addPreapproved(
      trimmed === "" ? { email: email.trim() } : { email: email.trim(), note: trimmed },
    ),
  );
}

/**
 * Remove a pre-approved email.
 *
 * @param email The email.
 * @returns Nothing on success, or the refusal.
 */
export async function removePreapprovedEmail(email: string): Promise<AdminWrite<null>> {
  return written(async () => {
    await adminAccounts.removePreapproved(email);
    return null;
  });
}
