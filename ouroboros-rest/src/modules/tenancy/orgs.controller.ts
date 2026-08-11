/**
 * `/api/v1/tenants/{tenantId}/orgs` — the GitHub organisations a tenant has enabled.
 *
 * Addressed by login rather than by id, because the login is what a person types, what a URL
 * elsewhere already carries, and what `github_orgs_tenant_login_key` makes unique within the
 * tenant. It is lower-case by construction (V003), so the route parameter is validated
 * against GitHub's own rule for a login before anything looks it up.
 */

import { Body, Controller, Get, Param, Patch, Post, Query, UseInterceptors } from "@nestjs/common";

import { ConstraintViolationInterceptor } from "./constraints";
import { OrgsService } from "./orgs.service";
import { PageQuery, type Page } from "./pagination";
import { ADMINISTRATORS, Roles } from "./roles.guard";
import type { OrgResource } from "./resources";
import { CreateOrgBody, OrgParams, TenantParams, UpdateOrgBody } from "./tenancy.dto";

@Controller("tenants/:tenantId/orgs")
@UseInterceptors(ConstraintViolationInterceptor)
export class OrgsController {
  constructor(private readonly orgs: OrgsService) {}

  /**
   * `GET …/orgs` — one page of this tenant's organisations, enabled or not.
   *
   * @param params - The tenant's id.
   * @param query - `limit` and `offset`.
   * @returns The page.
   */
  @Get()
  list(@Param() params: TenantParams, @Query() query: PageQuery): Promise<Page<OrgResource>> {
    return this.orgs.list(params.tenantId, query);
  }

  /**
   * `POST …/orgs` — record an organisation for this tenant.
   *
   * @param params - The tenant's id.
   * @param body - The login, and whether it starts enabled. It does not, unless asked.
   * @returns The organisation as it was stored, with `201`.
   */
  @Roles(...ADMINISTRATORS)
  @Post()
  add(@Param() params: TenantParams, @Body() body: CreateOrgBody): Promise<OrgResource> {
    return this.orgs.add(params.tenantId, body);
  }

  /**
   * `PATCH …/orgs/{login}` — enable or disable it.
   *
   * @param params - The tenant's id and the organisation's login.
   * @param body - `enabled`.
   * @returns The organisation after the change.
   */
  @Roles(...ADMINISTRATORS)
  @Patch(":login")
  setEnabled(@Param() params: OrgParams, @Body() body: UpdateOrgBody): Promise<OrgResource> {
    return this.orgs.setEnabled(params.tenantId, params.login, body);
  }
}
