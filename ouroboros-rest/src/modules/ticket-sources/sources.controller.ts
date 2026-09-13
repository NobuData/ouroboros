/**
 * `/api/v1/sources` — the source-management API
 * (Q.4, [#141](https://github.com/NobuData/ouroboros/issues/141)).
 *
 * **The workspace is the session's, never the request's** — the sentence every workspace-scoped
 * controller in this service opens with, and load-bearing here the way it is for
 * `/api/v1/providers`: the rows these operations address carry sealed credentials, so a
 * workspace taken from a path segment would be one edited URL away from another tenant's
 * tracker. There is no `{orgId}` in these paths; the tenant guard resolves and membership-checks
 * the active organization, and these handlers read what it established.
 *
 * **Members read; administrators write.** The four `GET`s carry no `@Roles()`, per the roles
 * guard's own rule that a bare route is any of the four — a viewer is a role that exists to be
 * able to look at which trackers a workspace watches, and every field they can see is masked.
 * Everything else carries `@Roles(...ADMINISTRATORS)`, which is the issue's *"a member sees the
 * surface read-only; owner/admin can write"*. **Test and sync are writes for this purpose**:
 * neither changes a row, and both spend a credential's budget against somebody else's API,
 * which is the property `backlog.controller.ts` gates its own sync on.
 *
 * **`catalog` is declared before `:id`, and that is not a stylistic choice.** Express matches
 * routes in registration order and `SourceParams` refuses anything that is not a uuid, so a
 * `catalog` declared after the read would be answered `422` by the read, as *not a source id*.
 * `sources.controller.spec.ts` holds the order.
 *
 * Sessions are required without anything here saying so — the global guard — and a tenant is
 * required *because* nothing here says otherwise: no `@TenantOptional()`, so a session acting
 * in no workspace is a `400 organization_required` before any handler runs.
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";

import type { Organization } from "../db/schema";
import type { Page } from "../tenancy/pagination";
import { ADMINISTRATORS, Roles } from "../tenancy/roles.guard";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import {
  CreateSourceDto,
  ListSourcesQuery,
  SetCredentialsDto,
  SourceParams,
  UpdateSourceDto,
} from "./sources.dto";
import type {
  TicketSourceCatalogResource,
  TicketSourceResource,
  TicketSourceStatusResource,
  TicketSourceTestResource,
} from "./sources.resources";
import { SourcesService } from "./sources.service";

@Controller("sources")
export class SourcesController {
  constructor(private readonly sources: SourcesService) {}

  /**
   * `GET /api/v1/sources` — this workspace's sources, each with a masked credential.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param query - The window.
   * @returns The page, by display name.
   */
  @Get()
  list(
    @CurrentTenant() tenant: Organization,
    @Query() query: ListSourcesQuery,
  ): Promise<Page<TicketSourceResource>> {
    return this.sources.list(tenant.id, query);
  }

  /**
   * `GET /api/v1/sources/catalog` — the kinds this build can connect, each with its form.
   *
   * Declared before `:id` — see this file's header. No `@Roles()`: the catalog names no
   * credential and no workspace fact, and the flow it starts is gated where it writes.
   *
   * @returns The catalog.
   */
  @Get("catalog")
  catalog(): TicketSourceCatalogResource {
    return this.sources.catalog();
  }

  /**
   * `GET /api/v1/sources/{id}` — one source.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param params - The source's id.
   * @returns The source.
   */
  @Get(":id")
  read(
    @CurrentTenant() tenant: Organization,
    @Param() params: SourceParams,
  ): Promise<TicketSourceResource> {
    return this.sources.read(tenant.id, params.id);
  }

  /**
   * `POST /api/v1/sources` — add a source.
   *
   * `201`, because a resource is created.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param body - The validated request.
   * @returns The source as stored.
   */
  @Roles(...ADMINISTRATORS)
  @Post()
  add(
    @CurrentTenant() tenant: Organization,
    @Body() body: CreateSourceDto,
  ): Promise<TicketSourceResource> {
    return this.sources.add(tenant.id, body);
  }

  /**
   * `PATCH /api/v1/sources/{id}` — the name, the settings, the pause.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param params - The source's id.
   * @param body - What changes.
   * @returns The source after the change.
   */
  @Roles(...ADMINISTRATORS)
  @Patch(":id")
  update(
    @CurrentTenant() tenant: Organization,
    @Param() params: SourceParams,
    @Body() body: UpdateSourceDto,
  ): Promise<TicketSourceResource> {
    return this.sources.update(tenant.id, params.id, body);
  }

  /**
   * `POST /api/v1/sources/{id}/credentials` — store a credential, write-only.
   *
   * `200` rather than Nest's default `201` for a `POST`: nothing is created, the source is
   * updated. The verb is protecting the argument rather than describing one — a credential in a
   * body, never in a request line.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param params - The source's id.
   * @param body - The credential.
   * @returns The source, with a masked echo of what was stored.
   */
  @Roles(...ADMINISTRATORS)
  @Post(":id/credentials")
  @HttpCode(HttpStatus.OK)
  setCredentials(
    @CurrentTenant() tenant: Organization,
    @Param() params: SourceParams,
    @Body() body: SetCredentialsDto,
  ): Promise<TicketSourceResource> {
    return this.sources.setCredentials(tenant.id, params.id, body);
  }

  /**
   * `POST /api/v1/sources/{id}/test` — ask the provider whether this source works.
   *
   * A `POST` with no body, because it reaches a tracker. `200` whatever the tracker said — a
   * refusal is an *answer* this route exists to carry. The only refusals this operation answers
   * itself are about the *request*: no such source, no provider for its kind.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param params - The source's id.
   * @returns What the provider said.
   */
  @Roles(...ADMINISTRATORS)
  @Post(":id/test")
  @HttpCode(HttpStatus.OK)
  test(
    @CurrentTenant() tenant: Organization,
    @Param() params: SourceParams,
  ): Promise<TicketSourceTestResource> {
    return this.sources.test(tenant.id, params.id);
  }

  /**
   * `POST /api/v1/sources/{id}/sync` — sync this source now.
   *
   * `202` rather than `200`: the sync outlives the response, so what this answers is *the
   * request was accepted* plus the status as it stood at that moment — `running: true`, and a
   * `syncedAt` the sync has not moved yet.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param params - The source's id.
   * @returns The status at acceptance.
   */
  @Roles(...ADMINISTRATORS)
  @Post(":id/sync")
  @HttpCode(HttpStatus.ACCEPTED)
  sync(
    @CurrentTenant() tenant: Organization,
    @Param() params: SourceParams,
  ): Promise<TicketSourceStatusResource> {
    return this.sources.syncNow(tenant.id, params.id);
  }

  /**
   * `GET /api/v1/sources/{id}/status` — how this source's sync stands, and why it is not
   * fresher.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param params - The source's id.
   * @returns The report. Never a `404` for a source that exists: a source that has never been
   *   synced has a state, and saying which one is the whole point of the endpoint.
   */
  @Get(":id/status")
  status(
    @CurrentTenant() tenant: Organization,
    @Param() params: SourceParams,
  ): Promise<TicketSourceStatusResource> {
    return this.sources.status(tenant.id, params.id);
  }
}
