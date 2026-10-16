/**
 * The account-approval routes' answers, as the public API publishes them (`openapi.yaml`'s
 * `AccountStatusResource`, `AdminAccount`, `PreapprovedEmail` and friends).
 */

import type { AccountStatus, AccountStatusReason } from "../db/schema";

/** `GET /api/v1/account/status`. */
export interface AccountStatusResource {
  /** The caller's effective status — `approved` for an application administrator. */
  readonly status: AccountStatus;
  /** Whether the caller is an application administrator (`OURO_APP_ADMIN_EMAILS`). */
  readonly appAdmin: boolean;
  /** The caller's address. */
  readonly email: string;
}

/** One account, as the admin page lists it. */
export interface AdminAccountResource {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  /** The GitHub login at the first sign-in, or `null`. */
  readonly githubLogin: string | null;
  /** The stored status. */
  readonly status: AccountStatus;
  /** When the account was created — its first sign-in. ISO 8601. */
  readonly createdAt: string;
  /** When the status was last decided, or `null`. ISO 8601. */
  readonly statusChangedAt: string | null;
  /** The deciding administrator's address, or `null` for an automatic decision. */
  readonly statusChangedBy: string | null;
  /** Why — the automatic reason or the administrator's action — or `null`. */
  readonly statusReason: AccountStatusReason | null;
}

/** `GET /api/v1/admin/accounts`. */
export interface AdminAccountsResource {
  /** Newest first, at most 200. */
  readonly accounts: readonly AdminAccountResource[];
}

/** One pre-approved address. */
export interface PreapprovedEmailResource {
  readonly email: string;
  readonly addedBy: string;
  /** ISO 8601. */
  readonly createdAt: string;
  readonly note: string | null;
}

/** `GET /api/v1/admin/preapproved-emails`. */
export interface PreapprovedEmailsResource {
  /** Newest first. */
  readonly emails: readonly PreapprovedEmailResource[];
}

/**
 * `POST /api/v1/admin/preapproved-emails` — the entry added, and the pending account it
 * approved on the spot (decision: a pre-approval of an address already waiting approves it).
 */
export interface AddedPreapprovedEmailResource extends PreapprovedEmailResource {
  /** The account approved because it was waiting under this address, or `null`. */
  readonly approvedAccount: AdminAccountResource | null;
}
