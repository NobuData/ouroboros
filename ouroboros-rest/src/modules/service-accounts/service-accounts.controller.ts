/**
 * `/api/v1/settings/service-accounts` — the Members card's non-human principals
 * ([#485](https://github.com/NobuData/ouroboros/issues/485), BR.1).
 *
 * **Administrators only, people only.** Every route is `@Roles(...ADMINISTRATORS)`, and so no
 * service account can reach them whatever its scopes (`auth/service.scopes.ts`, rule 3–4): a bot
 * cannot mint itself a sibling or rotate its own way out of a revocation.
 *
 * Create and rotate are the only answers that carry a token, and they carry it once.
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from "@nestjs/common";
import { Session } from "@thallesp/nestjs-better-auth";

import type { Principal } from "../auth/principal";
import type { Organization } from "../db/schema";
import { ADMINISTRATORS, Roles } from "../tenancy/roles.guard";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import { CreateServiceAccountDto } from "./service-accounts.dto";
import type {
  ServiceAccountListResource,
  ServiceAccountResource,
  ServiceAccountSecretResource,
} from "./service-accounts.resources";
import { ServiceAccountsService } from "./service-accounts.service";

@Controller("settings/service-accounts")
@Roles(...ADMINISTRATORS)
export class ServiceAccountsController {
  /**
   * @param accounts - The lifecycle.
   */
  constructor(private readonly accounts: ServiceAccountsService) {}

  /**
   * Every service account, tokens masked, with the registered scopes.
   *
   * @param tenant - The workspace.
   * @returns The list.
   */
  @Get()
  list(@CurrentTenant() tenant: Organization): Promise<ServiceAccountListResource> {
    return this.accounts.list(tenant.id);
  }

  /**
   * Create an account. The answer carries its token — the only time it ever will.
   *
   * @param tenant - The workspace.
   * @param principal - Who created it.
   * @param request - The name and scopes.
   * @returns The account and its token, `201`.
   */
  @Post()
  create(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Body() request: CreateServiceAccountDto,
  ): Promise<ServiceAccountSecretResource> {
    return this.accounts.create(tenant.id, principal.user.id, request);
  }

  /**
   * Rotate the token. The old one stops working immediately.
   *
   * @param tenant - The workspace.
   * @param principal - Who rotated it.
   * @param id - The account.
   * @returns The account and its new token.
   */
  @Post(":id/rotate")
  @HttpCode(HttpStatus.OK)
  rotate(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<ServiceAccountSecretResource> {
    return this.accounts.rotate(tenant.id, principal.user.id, id);
  }

  /**
   * Revoke the account: its token dies and it is disabled.
   *
   * @param tenant - The workspace.
   * @param principal - Who revoked it.
   * @param id - The account.
   * @returns The account, disabled.
   */
  @Post(":id/revoke")
  @HttpCode(HttpStatus.OK)
  revoke(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<ServiceAccountResource> {
    return this.accounts.revoke(tenant.id, principal.user.id, id);
  }
}
