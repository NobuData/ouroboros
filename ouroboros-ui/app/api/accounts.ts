import "server-only";

/**
 * Account approval's routes — the caller's own status, and the application administrators'
 * accounts and pre-approved emails.
 *
 * The usual resource facade over the generated client: the shapes are the contract's
 * (`components["schemas"][…]`, from `ouroboros-rest`'s OpenAPI via `yarn api:sync`), and every
 * call goes through the wired client's middleware — the session cookies travel, a `401` routes to
 * the login screen, and a held account's `403` routes to the waiting page (`app/api/server.ts`).
 */

import { type ApiClient, unwrap } from "@/app/api/client";
import type { components } from "@/app/api/schema";
import { api } from "@/app/api/server";

/** Where an account stands: let in, waiting for an administrator, or refused by one. */
export type AccountStatusValue = components["schemas"]["AccountStatus"];

/** Why an account stands where it does — automatic (`held`, `invited`, …) or an administrator's. */
export type AccountStatusReason = components["schemas"]["AccountStatusReason"];

/** `GET /api/v1/account/status` — the caller's own standing. Open to held accounts. */
export type AccountStatus = components["schemas"]["AccountStatusResource"];

/** One account, as the administrators' listing and the approve/deny answers carry it. */
export type AdminAccount = components["schemas"]["AdminAccount"];

/** `GET /api/v1/admin/accounts` — newest first, at most 200. */
export type AdminAccountList = components["schemas"]["AdminAccounts"];

/** One email an administrator let in ahead of its first sign-in. */
export type PreapprovedEmail = components["schemas"]["PreapprovedEmail"];

/** `GET /api/v1/admin/preapproved-emails`. */
export type PreapprovedEmailList = components["schemas"]["PreapprovedEmails"];

/** `POST /api/v1/admin/preapproved-emails`'s body. */
export type PreapprovedEmailInput = components["schemas"]["PreapprovedEmailCreate"];

/**
 * `POST /api/v1/admin/preapproved-emails`'s answer: the entry added, and the pending account
 * it approved in the same request (or `null`).
 */
export type AddedPreapprovedEmail = components["schemas"]["AddedPreapprovedEmail"];

/** The caller's own standing — the one account-approval read a held account may make. */
export const accountStatus = {
  /**
   * `GET /api/v1/account/status`.
   *
   * @param client The client to call through. The waiting page passes `anonymousApi()`, so a
   *   `401` comes back as an error to answer rather than a redirect.
   * @returns The caller's status, whether they are an application administrator, and their email.
   * @throws {ApiError} What the service answered.
   */
  async read(client: ApiClient = api()): Promise<AccountStatus> {
    return unwrap(await client.GET("/api/v1/account/status"));
  },
};

/** The application administrators' routes. Anyone else is answered `403 app_admin_required`. */
export const adminAccounts = {
  /**
   * `GET /api/v1/admin/accounts?status=…`.
   *
   * @param status Which accounts to list.
   * @param client The client to call through.
   * @returns The accounts in that status, newest first, at most 200.
   * @throws {ApiError} What the service answered.
   */
  async list(status: AccountStatusValue, client: ApiClient = api()): Promise<AdminAccountList> {
    return unwrap(
      await client.GET("/api/v1/admin/accounts", {
        params: { query: { status } },
      }),
    );
  },

  /**
   * `POST /api/v1/admin/accounts/{userId}/approve` — which also creates the person's workspace
   * and emails them when SMTP is configured.
   *
   * @param userId The account to approve.
   * @param client The client to call through.
   * @returns The account as it now stands.
   * @throws {ApiError} What the service answered — `404 account_not_found` among them.
   */
  async approve(userId: string, client: ApiClient = api()): Promise<AdminAccount> {
    return unwrap(
      await client.POST("/api/v1/admin/accounts/{userId}/approve", {
        params: { path: { userId } },
      }),
    );
  },

  /**
   * `POST /api/v1/admin/accounts/{userId}/deny`.
   *
   * @param userId The account to deny.
   * @param client The client to call through.
   * @returns The account as it now stands.
   * @throws {ApiError} What the service answered — `404 account_not_found` and `409 cannot_deny_app_admin` among them.
   */
  async deny(userId: string, client: ApiClient = api()): Promise<AdminAccount> {
    return unwrap(
      await client.POST("/api/v1/admin/accounts/{userId}/deny", {
        params: { path: { userId } },
      }),
    );
  },

  /**
   * `GET /api/v1/admin/preapproved-emails`.
   *
   * @param client The client to call through.
   * @returns Every pre-approved email.
   * @throws {ApiError} What the service answered.
   */
  async preapproved(client: ApiClient = api()): Promise<PreapprovedEmailList> {
    return unwrap(await client.GET("/api/v1/admin/preapproved-emails"));
  },

  /**
   * `POST /api/v1/admin/preapproved-emails`. A pending account with that email is approved in
   * the same request, and the answer says so.
   *
   * @param input The email and an optional note.
   * @param client The client to call through.
   * @returns The entry added, with `approvedAccount` set when a waiting account was approved.
   * @throws {ApiError} What the service answered — `409 already_preapproved` among them.
   */
  async addPreapproved(
    input: PreapprovedEmailInput,
    client: ApiClient = api(),
  ): Promise<AddedPreapprovedEmail> {
    return unwrap(await client.POST("/api/v1/admin/preapproved-emails", { body: input }));
  },

  /**
   * `DELETE /api/v1/admin/preapproved-emails/{email}`.
   *
   * @param email The email to forget.
   * @param client The client to call through.
   * @returns Nothing — the service answers `204`.
   * @throws {ApiError} What the service answered — `404 preapproved_email_not_found` among them.
   */
  async removePreapproved(email: string, client: ApiClient = api()): Promise<void> {
    await client.DELETE("/api/v1/admin/preapproved-emails/{email}", {
      params: { path: { email } },
    });
  },
};
