/**
 * `/api/v1/providers` — the credential lifecycle
 * ([#223](https://github.com/NobuData/ouroboros/issues/223)).
 *
 * **The workspace is the session's, never the request's** — the same sentence the dashboard,
 * runs, queue, settings, pricing and provider-health controllers open with, and load-bearing
 * here in the way it is nowhere else: the rows these operations address carry sealed
 * credentials, so a workspace taken from a path segment would be one edited URL away from
 * another tenant's key. There is no `{orgId}` in these paths; the tenant guard resolves and
 * membership-checks the active organization, and these handlers read what it established.
 *
 * **Members read; administrators write.** The two `GET`s carry no `@Roles()`, per the roles
 * guard's own rule that a bare route is any of the four — a viewer is a role that exists to
 * be able to look at which providers a workspace has, and every field they can see is
 * masked. Everything else carries `@Roles(...ADMINISTRATORS)`, which is the ticket's *member
 * role is read-only across every write endpoint, enforced server-side*. **Reveal is a write
 * for this purpose**, and that is the one classification worth defending: it changes
 * nothing, and it is the single operation in this API that hands back a live credential, so
 * grouping it with the reads because of its side effects would be filing it by the wrong
 * property.
 *
 * **This is the path `provider-health` deliberately did not take.** Z.3's health strip is
 * served at `/api/v1/routing/providers` precisely so that `/api/v1/providers` was free for
 * mockup 07's CRUD surface — decision **M2**, and that controller's header says so in as
 * many words. This is that surface.
 *
 * Sessions are required without anything here saying so — the global guard — and a tenant is
 * required *because* nothing here says otherwise: no `@TenantOptional()`, so a session
 * acting in no workspace is a `400 organization_required` before any handler runs.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { Session } from "@thallesp/nestjs-better-auth";

import type { AuthRequest } from "../auth/http";
import type { Principal } from "../auth/principal";
import type { Organization } from "../db/schema";
import type { Page } from "../tenancy/pagination";
import { ADMINISTRATORS, Roles } from "../tenancy/roles.guard";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import {
  ConnectionParams,
  CreateConnectionDto,
  ListConnectionsQuery,
  PullModelDto,
  RevealConnectionDto,
  RotateConnectionDto,
  UpdateConnectionDto,
} from "./provider-connections.dto";
import { ProviderConnectionsService } from "./provider-connections.service";
import type { ProviderCatalogResource } from "./catalog";
import type { ProviderTestResource } from "./connection-test";
import type { ProviderDiscoveryResource, ProviderModelsResource } from "./models";
import type { ModelPullResource, ModelPullsResource } from "./pulls";
import type { ProviderConnectionResource, RevealResource } from "./resources";
import type { ProviderMonthlySpendResource } from "./spend";

@Controller("providers")
export class ProviderConnectionsController {
  constructor(private readonly connections: ProviderConnectionsService) {}

  /**
   * `GET /api/v1/providers` — this workspace's connections, each with a masked credential.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param query - The window. Defaults per the #31 pagination convention.
   * @returns The page, ordered by name.
   */
  @Get()
  list(
    @CurrentTenant() tenant: Organization,
    @Query() query: ListConnectionsQuery,
  ): Promise<Page<ProviderConnectionResource>> {
    return this.connections.list(tenant.id, query);
  }

  /**
   * `GET /api/v1/providers/catalog` — the kinds this build can connect, each with its form.
   *
   * **Declared before `:id`, and that is not a stylistic choice.** Express matches routes in
   * the order they were registered, and `ConnectionParams` refuses anything that is not a
   * uuid — so a `catalog` declared after the read below would be answered `422` by the read,
   * as *not a connection id*. `audit.controller.ts` sits in a module Nest registers earlier,
   * which is how `/providers/audit` escapes the same fate; this one lives here, so it goes
   * first. `provider-connections.controller.spec.ts` holds the order.
   *
   * No `@Roles()`: any member. The catalog names no credential and no workspace fact — it is
   * *what could be connected*, which is the same kind of question as *what is connected* and
   * is open to the same readers. The flow it starts is gated where it writes, at `add`.
   *
   * @returns The catalog — see `catalog.ts`.
   */
  @Get("catalog")
  catalog(): ProviderCatalogResource {
    return this.connections.catalog();
  }

  /**
   * `GET /api/v1/providers/spend` — this workspace's calendar-month spend, per provider kind.
   *
   * Declared before `:id` for `catalog`'s reason, and held to the same place by the spec. No
   * `@Roles()`: any member — what a workspace spends on models is something everybody in it
   * may look at, which is the rule `GET /api/v1/routing/spend` already keeps.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @returns The month and its rows — see `spend.ts`.
   */
  @Get("spend")
  spend(@CurrentTenant() tenant: Organization): Promise<ProviderMonthlySpendResource> {
    return this.connections.spend(tenant.id);
  }

  /**
   * `GET /api/v1/providers/{id}` — one connection, with a masked credential.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param params - The connection's id.
   * @returns The connection.
   */
  @Get(":id")
  read(
    @CurrentTenant() tenant: Organization,
    @Param() params: ConnectionParams,
  ): Promise<ProviderConnectionResource> {
    return this.connections.read(tenant.id, params.id);
  }

  /**
   * `POST /api/v1/providers` — connect a provider.
   *
   * `201`, because a resource is created — and it is created only after the provider itself
   * has agreed, which is the whole shape of the operation. See the service.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param principal - The session, for `added_by` and for the audit event. Read from the
   *   session rather than from the body: *who added this provider* is a fact about the
   *   request, and a body field would let a client attribute its own writes to somebody else.
   * @param body - The validated request.
   * @returns The connection as stored.
   */
  @Roles(...ADMINISTRATORS)
  @Post()
  add(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Body() body: CreateConnectionDto,
  ): Promise<ProviderConnectionResource> {
    return this.connections.add(tenant.id, principal.user.id, body);
  }

  /**
   * `POST /api/v1/providers/{id}/reveal` — hand back a stored credential.
   *
   * `200` rather than Nest's default `201` for a `POST`: nothing is created. The verb is
   * protecting the argument rather than describing one — a password may be in the body, and
   * a `GET` would put the operation in a request line, a browser history and a `Referer`,
   * and would make the one endpoint that answers with a credential cacheable by anything in
   * between. `POST /api/v1/auth/discover` is written the same way for the same two reasons.
   *
   * `Cache-Control: no-store` is declared here rather than in the service, because it is a
   * fact about the *response* and the service returns a value. It is the strongest of the
   * cache directives and the correct one: `no-cache` permits a stored copy that is
   * revalidated, which for a credential is a stored copy.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param principal - The session — whose attempts are counted and whose step-up is checked.
   * @param request - The raw request, for the `Cookie` header the step-up's password check
   *   authenticates with. Nothing else on it is read; see `auth/http.ts` on why the surface
   *   is named rather than imported from Express.
   * @param params - The connection's id.
   * @param body - The validated request; carries a password when stepping up with one.
   * @returns The credential, and when a client should stop showing it.
   */
  @Roles(...ADMINISTRATORS)
  @Post(":id/reveal")
  @HttpCode(HttpStatus.OK)
  @Header("Cache-Control", "no-store")
  reveal(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Req() request: AuthRequest,
    @Param() params: ConnectionParams,
    @Body() body: RevealConnectionDto,
  ): Promise<RevealResource> {
    return this.connections.reveal(tenant.id, principal, request, params.id, body);
  }

  /**
   * `POST /api/v1/providers/{id}/rotate` — replace a credential, verify-then-retire.
   *
   * `200` for {@link reveal}'s reason: the connection is updated rather than created, and
   * what comes back is the connection as it now stands.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param principal - The session, for the audit event.
   * @param params - The connection's id.
   * @param body - The new credential.
   * @returns The connection after the swap.
   */
  @Roles(...ADMINISTRATORS)
  @Post(":id/rotate")
  @HttpCode(HttpStatus.OK)
  rotate(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Param() params: ConnectionParams,
    @Body() body: RotateConnectionDto,
  ): Promise<ProviderConnectionResource> {
    return this.connections.rotate(tenant.id, principal.user.id, params.id, body);
  }

  /**
   * `PATCH /api/v1/providers/{id}` — the switch, the cap, the note, the address.
   *
   * A `PATCH` rather than a `PUT`, which is the opposite of the choice `pricing.controller.ts`
   * makes and for a reason that is about the resource rather than about taste: a price is one
   * statement replaced outright, and a connection is a row of independent settings where
   * *turn this off* should not require resending an address a client may not even have.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param principal - The session, for the audit event.
   * @param params - The connection's id.
   * @param body - The validated request.
   * @returns The connection after the change.
   */
  @Roles(...ADMINISTRATORS)
  @Patch(":id")
  update(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Param() params: ConnectionParams,
    @Body() body: UpdateConnectionDto,
  ): Promise<ProviderConnectionResource> {
    return this.connections.update(tenant.id, principal.user.id, params.id, body);
  }

  /**
   * `DELETE /api/v1/providers/{id}` — disconnect a provider.
   *
   * `204`, and no body: there is nothing to say about a row that no longer exists, and a
   * `200` carrying the deleted resource invites a client to keep using it — the same
   * sentence `domains.controller.ts` opens its own delete with.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param principal - The session, for the audit event.
   * @param params - The connection's id.
   * @returns When it is gone.
   */
  @Roles(...ADMINISTRATORS)
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Param() params: ConnectionParams,
  ): Promise<void> {
    return this.connections.remove(tenant.id, principal.user.id, params.id);
  }

  /**
   * `POST /api/v1/providers/{id}/test` — ask the provider whether this connection works.
   *
   * A `POST` with no body, because it has a side effect the card depends on: the answer is
   * written to `provider_connections.status` and Z.3's snapshot, so the routing strip agrees
   * with the pill. `200` whatever the provider said — a `503` upstream is an *answer* this
   * route exists to carry, and turning it into a `4xx` of our own would be a card that could
   * not draw the state mockup 07 draws.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param principal - The session, for the audit event.
   * @param params - The connection's id.
   * @returns What the provider said, composed for the card foot.
   */
  @Roles(...ADMINISTRATORS)
  @Post(":id/test")
  @HttpCode(HttpStatus.OK)
  test(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Param() params: ConnectionParams,
  ): Promise<ProviderTestResource> {
    return this.connections.test(tenant.id, principal.user.id, params.id);
  }

  /**
   * `GET /api/v1/providers/{id}/models` — the discovered catalog, and the aliases it stranded.
   *
   * A read of what the last discovery wrote. Any member: the chips are on a card every member
   * may look at, and nothing in a model id is a secret.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param params - The connection's id.
   * @returns The catalog.
   */
  @Get(":id/models")
  models(
    @CurrentTenant() tenant: Organization,
    @Param() params: ConnectionParams,
  ): Promise<ProviderModelsResource> {
    return this.connections.models(tenant.id, params.id);
  }

  /**
   * `POST /api/v1/providers/{id}/discover` — ask the provider what it serves, and store it.
   *
   * The write V017 left to this ticket. `200` with the catalog as it now stands and what
   * changed, rather than `202`: discovery is one listing call and the row writes are done
   * before the answer, so there is nothing to poll for.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param params - The connection's id.
   * @returns The catalog, with `added` and `removed`.
   */
  @Roles(...ADMINISTRATORS)
  @Post(":id/discover")
  @HttpCode(HttpStatus.OK)
  discover(
    @CurrentTenant() tenant: Organization,
    @Param() params: ConnectionParams,
  ): Promise<ProviderDiscoveryResource> {
    return this.connections.discover(tenant.id, params.id);
  }

  /**
   * `POST /api/v1/providers/{id}/pulls` — ask the host to pull a model.
   *
   * `202`: the transfer is the tracker's and takes minutes; what comes back is the record as it
   * stands, which is `running` or `queued`. The same answer for a model already in flight — a
   * second click is not a second pull — so a client that lost the first response can send the
   * request again and get the record it was looking for.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param params - The connection's id.
   * @param body - Which model.
   * @returns The record.
   */
  @Roles(...ADMINISTRATORS)
  @Post(":id/pulls")
  @HttpCode(HttpStatus.ACCEPTED)
  pull(
    @CurrentTenant() tenant: Organization,
    @Param() params: ConnectionParams,
    @Body() body: PullModelDto,
  ): Promise<ModelPullResource> {
    return this.connections.pull(tenant.id, params.id, body);
  }

  /**
   * `GET /api/v1/providers/{id}/pulls` — every pull this process knows about on a connection.
   *
   * What a card polls while a bar is moving, and reads on first render so a reload lands at
   * the current percentage rather than at an idle button. `no-store` for the reason reveal's
   * answer carries it: a cached copy of a progress report is a report that stopped moving.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param params - The connection's id.
   * @returns The pulls, oldest request first.
   */
  @Get(":id/pulls")
  @Header("Cache-Control", "no-store")
  pulls(
    @CurrentTenant() tenant: Organization,
    @Param() params: ConnectionParams,
  ): Promise<ModelPullsResource> {
    return this.connections.pulls(tenant.id, params.id);
  }
}
