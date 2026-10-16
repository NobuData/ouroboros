/**
 * Account approval's routes (public API, session auth, not workspace-scoped).
 *
 *   * **`GET /api/v1/account/status`** — the caller's own status. `@AllowHeldAccount()`: it is the
 *     one product route a pending or denied person may reach, because the waiting page reads it.
 *   * **`/api/v1/admin/*`** — the application administrator's lists and decisions. Any other
 *     caller gets `403 app_admin_required` from the service.
 *
 * Every route is `@TenantOptional()` — they are about a person or the deployment, never a
 * workspace, and a held person has none — and `@HumanOnly()`: a service account is not a person,
 * holds no status and is no administrator.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { Session } from "@thallesp/nestjs-better-auth";

import { AllowHeldAccount } from "../auth/held.account";
import type { Principal } from "../auth/principal";
import { HumanOnly } from "../auth/service.scopes";
import { TenantOptional } from "../tenancy/tenant.decorators";
import { AddPreapprovedEmailDto, ListAccountsQuery } from "./accounts.dto";
import type {
  AccountStatusResource,
  AddedPreapprovedEmailResource,
  AdminAccountResource,
  AdminAccountsResource,
  PreapprovedEmailsResource,
} from "./accounts.resources";
import { AccountsService } from "./accounts.service";

/** `GET /api/v1/account/status`. */
@Controller("account")
@TenantOptional()
@HumanOnly()
export class AccountController {
  /**
   * @param accounts - The operations.
   */
  constructor(private readonly accounts: AccountsService) {}

  /**
   * The caller's status, whether they are an application administrator, and their address.
   *
   * @param principal - The session.
   * @returns `{ status, appAdmin, email }`.
   */
  @Get("status")
  @AllowHeldAccount()
  status(@Session() principal: Principal): Promise<AccountStatusResource> {
    return this.accounts.status(principal.user);
  }
}

/** `/api/v1/admin/accounts` and `/api/v1/admin/preapproved-emails` — administrators only. */
@Controller("admin")
@TenantOptional()
@HumanOnly()
export class AdminAccountsController {
  /**
   * @param accounts - The operations.
   */
  constructor(private readonly accounts: AccountsService) {}

  /**
   * One list of accounts, newest first, at most 200.
   *
   * @param principal - The session; must be an administrator's.
   * @param query - `status`: `pending` (default), `denied` or `approved`.
   * @returns `{ accounts }`.
   */
  @Get("accounts")
  list(
    @Session() principal: Principal,
    @Query() query: ListAccountsQuery,
  ): Promise<AdminAccountsResource> {
    return this.accounts.list(principal.user, query.status);
  }

  /**
   * Approve an account.
   *
   * @param principal - The session; must be an administrator's.
   * @param userId - The account.
   * @returns The account as it now stands.
   */
  @Post("accounts/:userId/approve")
  @HttpCode(HttpStatus.OK)
  approve(
    @Session() principal: Principal,
    @Param("userId") userId: string,
  ): Promise<AdminAccountResource> {
    return this.accounts.approve(principal.user, userId);
  }

  /**
   * Deny an account.
   *
   * @param principal - The session; must be an administrator's.
   * @param userId - The account.
   * @returns The account as it now stands.
   */
  @Post("accounts/:userId/deny")
  @HttpCode(HttpStatus.OK)
  deny(
    @Session() principal: Principal,
    @Param("userId") userId: string,
  ): Promise<AdminAccountResource> {
    return this.accounts.deny(principal.user, userId);
  }

  /**
   * The pre-approved addresses.
   *
   * @param principal - The session; must be an administrator's.
   * @returns `{ emails }`.
   */
  @Get("preapproved-emails")
  listPreapproved(@Session() principal: Principal): Promise<PreapprovedEmailsResource> {
    return this.accounts.listPreapproved(principal.user);
  }

  /**
   * Pre-approve an address; approves a pending account already waiting under it.
   *
   * @param principal - The session; must be an administrator's.
   * @param body - `{ email, note? }`.
   * @returns `201` with the entry and `approvedAccount`.
   */
  @Post("preapproved-emails")
  addPreapproved(
    @Session() principal: Principal,
    @Body() body: AddPreapprovedEmailDto,
  ): Promise<AddedPreapprovedEmailResource> {
    return this.accounts.addPreapproved(principal.user, body);
  }

  /**
   * Remove a pre-approved address.
   *
   * @param principal - The session; must be an administrator's.
   * @param email - The address, URL-encoded.
   */
  @Delete("preapproved-emails/:email")
  @HttpCode(HttpStatus.NO_CONTENT)
  removePreapproved(@Session() principal: Principal, @Param("email") email: string): Promise<void> {
    return this.accounts.removePreapproved(principal.user, email);
  }
}
