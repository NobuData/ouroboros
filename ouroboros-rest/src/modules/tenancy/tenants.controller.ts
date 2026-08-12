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
 *   * **`@TenantOptional()` on the two routes that have no tenant to be in**, and nothing
 *     on the two that do. That is the same polarity `@AllowAnonymous()` has: the
 *     authentication guard ([#703](https://github.com/NobuData/ouroboros/issues/703)) and
 *     the tenant guard ([#32](https://github.com/NobuData/ouroboros/issues/32)) are both
 *     global, so a route needs a session and a membership unless it says otherwise, and a
 *     route added later is scoped because somebody wrote a controller. Listing and creating
 *     are the exceptions because both are questions about the *person* — which workspaces
 *     are mine, and let me have one — and requiring a workspace first would be circular.
 *   * **`@Roles(…)` on the mutation and not on the read.** A `viewer` is a role that exists
 *     to be able to look; renaming or suspending a workspace is an administrator's. The
 *     read carries nothing because the tenant guard has already refused anybody who is not
 *     a member.
 */

import { Body, Controller, Get, Param, Patch, Post, Query, UseInterceptors } from "@nestjs/common";
import { Session } from "@thallesp/nestjs-better-auth";

import { principalUser, type Principal } from "../auth/principal";
import { ConstraintViolationInterceptor } from "./constraints";
import { PageQuery, type Page } from "./pagination";
import type { TenantResource } from "./resources";
import { ADMINISTRATORS, Roles } from "./roles.guard";
import { TenantOptional } from "./tenant.decorators";
import { CreateTenantBody, TenantParams, UpdateTenantBody } from "./tenancy.dto";
import { TenantsService } from "./tenants.service";

@Controller("tenants")
@UseInterceptors(ConstraintViolationInterceptor)
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  /**
   * `GET /api/v1/tenants` — the workspaces the signed-in person belongs to.
   *
   * Not the installation's tenants: the listing is scoped to the caller
   * ([#32](https://github.com/NobuData/ouroboros/issues/32)), because a list that
   * enumerated every workspace would be a larger existence leak than the `403` this issue
   * replaced with a `404`, and it would be one request rather than a scan.
   *
   * `@TenantOptional()` for the reason the header of this file gives: it is the question a
   * workspace switcher asks *before* it can name a workspace.
   *
   * @param query - `limit` and `offset`, per the convention in `pagination.ts`.
   * @returns The page.
   */
  @TenantOptional()
  @Get()
  list(@Query() query: PageQuery): Promise<Page<TenantResource>> {
    return this.tenants.list(query);
  }

  /**
   * `POST /api/v1/tenants` — create one, and become its owner.
   *
   * The creator is made `owner` in the same transaction
   * ([#32](https://github.com/NobuData/ouroboros/issues/32)). Before this issue a new
   * tenant had no members at all, which was harmless while nothing was scoped and is a
   * workspace nobody can administer now that everything is: the `404` rule would put it
   * out of reach of the person who had just made it.
   *
   * `@TenantOptional()`, because somebody creating their first workspace belongs to none.
   *
   * @param principal - The session, established by the global authentication guard. Its
   *   person becomes the owner. Typed nullable because the library's `@Session()` decorator
   *   is; `principalUser` is what refuses a `null` loudly rather than three layers down —
   *   see `../auth/principal.ts`.
   * @param body - The slug and the display name.
   * @returns The tenant as it was stored, with `201`.
   */
  @TenantOptional()
  @Post()
  create(
    @Session() principal: Principal | null,
    @Body() body: CreateTenantBody,
  ): Promise<TenantResource> {
    return this.tenants.create(principalUser(principal), body);
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
  @Roles(...ADMINISTRATORS)
  @Patch(":tenantId")
  update(@Param() params: TenantParams, @Body() body: UpdateTenantBody): Promise<TenantResource> {
    return this.tenants.update(params.tenantId, body);
  }
}
