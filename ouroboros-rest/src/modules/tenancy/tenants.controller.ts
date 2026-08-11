/**
 * `/api/v1/tenants` — the first real resource this API serves.
 *
 * The controller does three things and no more: it names the route, it declares the shapes
 * a request may take, and it hands the validated result to a service. There is no query
 * here, no rule, and no mapping — a controller that reached for a repository would be a
 * second place tenancy rules could be written, and the point of the layering is that there
 * is one.
 *
 * Two decorations carry meaning:
 *
 *   * **`@UseInterceptors(ConstraintViolationInterceptor)`** on every tenancy controller.
 *     It maps a constraint the database refused into the envelope — the issue's worked
 *     example, `409 domain_taken` — including constraints no service anticipated.
 *   * **Nothing about authorization.** Role enforcement arrives with
 *     [#33](https://github.com/NobuData/ouroboros/issues/33)'s principal and
 *     [#32](https://github.com/NobuData/ouroboros/issues/32)'s `RolesGuard`, and the issue
 *     says so: *controllers take the authenticated principal from request context* once
 *     that lands. Until it does these routes are open, which is why nothing but a
 *     development stack should be running this build.
 */

import { Body, Controller, Get, Param, Patch, Post, Query, UseInterceptors } from "@nestjs/common";

import { ConstraintViolationInterceptor } from "./constraints";
import { PageQuery, type Page } from "./pagination";
import type { TenantResource } from "./resources";
import { CreateTenantBody, TenantParams, UpdateTenantBody } from "./tenancy.dto";
import { TenantsService } from "./tenants.service";

@Controller("tenants")
@UseInterceptors(ConstraintViolationInterceptor)
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  /**
   * `GET /api/v1/tenants` — one page of tenants.
   *
   * @param query - `limit` and `offset`, per the convention in `pagination.ts`.
   * @returns The page.
   */
  @Get()
  list(@Query() query: PageQuery): Promise<Page<TenantResource>> {
    return this.tenants.list(query);
  }

  /**
   * `POST /api/v1/tenants` — create one.
   *
   * @param body - The slug and the display name.
   * @returns The tenant as it was stored, with `201`.
   */
  @Post()
  create(@Body() body: CreateTenantBody): Promise<TenantResource> {
    return this.tenants.create(body);
  }

  /**
   * `GET /api/v1/tenants/{tenantId}` — read one.
   *
   * @param params - The tenant's id, checked to be a uuid before this runs.
   * @returns The tenant.
   */
  @Get(":tenantId")
  read(@Param() params: TenantParams): Promise<TenantResource> {
    return this.tenants.read(params.tenantId);
  }

  /**
   * `PATCH /api/v1/tenants/{tenantId}` — rename it, re-slug it, or change its status.
   *
   * The status is how a tenant is suspended and how it is soft-deleted; there is no
   * `DELETE` for a tenant, deliberately. See `UpdateTenantBody`.
   *
   * @param params - The tenant's id.
   * @param body - The fields to change. All optional.
   * @returns The tenant after the change.
   */
  @Patch(":tenantId")
  update(@Param() params: TenantParams, @Body() body: UpdateTenantBody): Promise<TenantResource> {
    return this.tenants.update(params.tenantId, body);
  }
}
