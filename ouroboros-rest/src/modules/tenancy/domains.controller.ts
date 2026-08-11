/**
 * `/api/v1/tenants/{tenantId}/domains` — the email domains that resolve a tenant at sign-in.
 *
 * The set-primary operation is a `PATCH` on one domain rather than a verb of its own
 * (`POST …/primary`), because "which of these is primary" is a property of the row and
 * `{"isPrimary": true}` is what changing it looks like. The issue lists it as an addition to
 * the three plain methods for that reason: it is a fourth operation, not a fourth resource.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseInterceptors,
} from "@nestjs/common";

import { ConstraintViolationInterceptor } from "./constraints";
import { DomainsService } from "./domains.service";
import { PageQuery, type Page } from "./pagination";
import { ADMINISTRATORS, Roles } from "./roles.guard";
import type { DomainResource } from "./resources";
import { CreateDomainBody, DomainParams, TenantParams, UpdateDomainBody } from "./tenancy.dto";

@Controller("tenants/:tenantId/domains")
@UseInterceptors(ConstraintViolationInterceptor)
export class DomainsController {
  constructor(private readonly domains: DomainsService) {}

  /**
   * `GET …/domains` — one page of this tenant's domains, the primary first.
   *
   * @param params - The tenant's id.
   * @param query - `limit` and `offset`.
   * @returns The page.
   */
  @Get()
  list(@Param() params: TenantParams, @Query() query: PageQuery): Promise<Page<DomainResource>> {
    return this.domains.list(params.tenantId, query);
  }

  /**
   * `POST …/domains` — claim a domain for this tenant.
   *
   * @param params - The tenant's id.
   * @param body - The domain, and whether it becomes the primary.
   * @returns The domain as it was stored, with `201`.
   */
  @Roles(...ADMINISTRATORS)
  @Post()
  add(@Param() params: TenantParams, @Body() body: CreateDomainBody): Promise<DomainResource> {
    return this.domains.add(params.tenantId, body);
  }

  /**
   * `PATCH …/domains/{domainId}` — promote this domain to primary, or demote it.
   *
   * @param params - The tenant's id and the domain's.
   * @param body - `isPrimary`.
   * @returns The domain after the change.
   */
  @Roles(...ADMINISTRATORS)
  @Patch(":domainId")
  setPrimary(
    @Param() params: DomainParams,
    @Body() body: UpdateDomainBody,
  ): Promise<DomainResource> {
    return this.domains.setPrimary(params.tenantId, params.domainId, body);
  }

  /**
   * `DELETE …/domains/{domainId}` — give the domain up.
   *
   * `204`, and no body: there is nothing to say about a row that no longer exists, and a
   * `200` carrying the deleted resource invites a client to keep using it.
   *
   * @param params - The tenant's id and the domain's.
   * @returns When it is gone.
   */
  @Roles(...ADMINISTRATORS)
  @Delete(":domainId")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param() params: DomainParams): Promise<void> {
    return this.domains.remove(params.tenantId, params.domainId);
  }
}
