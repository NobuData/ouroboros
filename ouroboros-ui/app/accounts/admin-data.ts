import "server-only";

/**
 * The accounts page's reads (account approval): whether the reader is an application
 * administrator, and the three lists the page draws.
 */

import {
  type AccountStatus,
  type AdminAccount,
  type AdminAccountList,
  type PreapprovedEmail,
  type PreapprovedEmailList,
  accountStatus,
  adminAccounts,
} from "@/app/api/accounts";
import { anonymousApi } from "@/app/api/server";

/** Everything `/admin/accounts` draws. */
export interface AdminAccountsReading {
  /** Accounts waiting for approval, newest first. */
  readonly pending: readonly AdminAccount[];
  /** Accounts an administrator refused, newest first. */
  readonly denied: readonly AdminAccount[];
  /** The pre-approved emails. */
  readonly preapproved: readonly PreapprovedEmail[];
}

/**
 * Whether the reader is an application administrator.
 *
 * **Any failure is `false`.** The answer only decides whether the **Accounts** entry and page are
 * shown, and the service refuses every administrator route to anyone else anyway, so the safe
 * reading of an answer that did not arrive is the one that shows nothing.
 *
 * @param read The status read. Defaults to the service's, through `anonymousApi()` so a `401`
 *   or a held account's `403` is an answer here rather than a redirect.
 * @returns `true` only for an answer that says `appAdmin: true`.
 */
export async function readAppAdmin(
  read: () => Promise<AccountStatus> = () => accountStatus.read(anonymousApi()),
): Promise<boolean> {
  try {
    return (await read()).appAdmin === true;
  } catch {
    return false;
  }
}

/** The three reads, injectable for the suites. */
export interface AdminAccountsReads {
  /** One status's accounts. */
  readonly list: (status: "pending" | "denied") => Promise<AdminAccountList>;
  /** The pre-approved emails. */
  readonly preapproved: () => Promise<PreapprovedEmailList>;
}

/**
 * Read the three lists, together.
 *
 * @param reads The reads. Default to the service's, through the wired client — the page is only
 *   reached by an administrator, so a refusal here is a real failure for the error boundary.
 * @returns The pending and denied accounts and the pre-approved emails.
 * @throws {ApiError} What the service answered.
 */
export async function readAdminAccounts(
  reads: AdminAccountsReads = {
    list: (status) => adminAccounts.list(status),
    preapproved: () => adminAccounts.preapproved(),
  },
): Promise<AdminAccountsReading> {
  const [pending, denied, preapproved] = await Promise.all([
    reads.list("pending"),
    reads.list("denied"),
    reads.preapproved(),
  ]);

  return {
    pending: pending.accounts,
    denied: denied.accounts,
    preapproved: preapproved.emails,
  };
}
