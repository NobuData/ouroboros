/**
 * `/api/v1/registry/aliases` — the alias lifecycle
 * ([#584](https://github.com/NobuData/ouroboros/issues/584)): every write mockup 21's
 * registry can make, and the two reads its table and inspector are drawn from.
 *
 * **The workspace is the session's, never the request's** — the sentence every controller
 * under `/api/v1` opens with. No `{orgId}` in these paths; the tenant guard resolves and
 * membership-checks the active organization, and every handler reads what it established.
 * An alias id from another workspace is a `404` here for the same reason it is everywhere: the
 * read is scoped, so the row is not there.
 *
 * **Members read; administrators write.** The two `GET`s carry no `@Roles()`, per the roles
 * guard's rule that a bare route is any of the four — a viewer is a role that exists to be
 * able to look at which names a workspace's routes point at. Everything else carries
 * `@Roles(...ADMINISTRATORS)`, which is the ticket's *owner/admin write, member read*.
 *
 * **This supersedes Z.2's alias list for the registry, and does not remove it.**
 * `GET /api/v1/routing/aliases` ([#195](https://github.com/NobuData/ouroboros/issues/195))
 * answers the swap menus with the resolution each alias currently has; this list answers the
 * registry page with the row itself — the switch, both documents, the note, and everything
 * that references it. Routing's read stays, because the routing page still consumes it and a
 * removed route is a breaking change for no gain; the Z.2 amendment records which surface
 * reads which.
 *
 * Sessions are required without anything here saying so — the global guard — and a tenant is
 * required *because* nothing here says otherwise: no `@TenantOptional()`, so a session acting
 * in no workspace is a `400 organization_required` before any handler runs.
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
} from "@nestjs/common";
import { Session } from "@thallesp/nestjs-better-auth";

import type { Principal } from "../auth/principal";
import type { Organization } from "../db/schema";
import { ADMINISTRATORS, Roles } from "../tenancy/roles.guard";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import { AliasParams, CreateAliasDto, ModelOptionsQuery, UpdateAliasDto } from "./aliases.dto";
import type {
  AliasChangeResource,
  ModelAliasListResource,
  ModelOptionListResource,
} from "./aliases.resources";
import { AliasesService } from "./aliases.service";

@Controller("registry/aliases")
export class AliasesController {
  constructor(private readonly aliases: AliasesService) {}

  /**
   * `GET /api/v1/registry/aliases` — the allowed-models table.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @returns Every alias, ordered by name, each with what references it.
   */
  @Get()
  list(@CurrentTenant() tenant: Organization): Promise<ModelAliasListResource> {
    return this.aliases.list(tenant.id);
  }

  /**
   * `GET /api/v1/registry/aliases/model-options?connection=` — the inspector's model select,
   * *listed live from the provider*.
   *
   * Declared before the `:id` routes, so `model-options` is a path and never an id that
   * fails to parse as a uuid.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param query - Which connection.
   * @returns The connection and the models discovery reported on it.
   */
  @Get("model-options")
  modelOptions(
    @CurrentTenant() tenant: Organization,
    @Query() query: ModelOptionsQuery,
  ): Promise<ModelOptionListResource> {
    return this.aliases.modelOptions(tenant.id, query.connection);
  }

  /**
   * `POST /api/v1/registry/aliases` — **+ New alias**, bound or unbound.
   *
   * `201`, because a resource is created.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param principal - The session, for `updated_by` and the revision's actor. Read from the
   *   session rather than from the body: *who created this* is a fact about the request, and
   *   a body field would let a client attribute its own writes to somebody else.
   * @param body - The validated request.
   * @returns The alias as stored, its revision, and any warnings.
   */
  @Roles(...ADMINISTRATORS)
  @Post()
  create(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Body() body: CreateAliasDto,
  ): Promise<AliasChangeResource> {
    return this.aliases.create(tenant.id, principal.user.id, body);
  }

  /**
   * `PATCH /api/v1/registry/aliases/{id}` — **Save alias**, the **On** switch, a rename, or
   * a rebind.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param principal - The session, as {@link create} reads it.
   * @param params - Which alias.
   * @param body - The fields to change.
   * @returns The alias after the change, and what the change did.
   */
  @Roles(...ADMINISTRATORS)
  @Patch(":id")
  update(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Param() params: AliasParams,
    @Body() body: UpdateAliasDto,
  ): Promise<AliasChangeResource> {
    return this.aliases.update(tenant.id, principal.user.id, params.id, body);
  }

  /**
   * `POST /api/v1/registry/aliases/{id}/duplicate` — **Duplicate**.
   *
   * `201`: a resource is created, and it is the copy that is answered.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param principal - The session, as {@link create} reads it.
   * @param params - Which alias to copy.
   * @returns The copy — `<alias>-copy`, switched off — and its revision.
   */
  @Roles(...ADMINISTRATORS)
  @Post(":id/duplicate")
  duplicate(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Param() params: AliasParams,
  ): Promise<AliasChangeResource> {
    return this.aliases.duplicate(tenant.id, principal.user.id, params.id);
  }

  /**
   * `DELETE /api/v1/registry/aliases/{id}` — **Remove**.
   *
   * `204`, and no body: there is nothing to say about a row that no longer exists, and a
   * `200` carrying the deleted resource invites a client to keep using it. A `409` is the
   * other answer, and it carries the referrer list.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param principal - The session, for the revision's actor.
   * @param params - Which alias.
   * @returns When it is gone.
   */
  @Roles(...ADMINISTRATORS)
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Param() params: AliasParams,
  ): Promise<void> {
    return this.aliases.remove(tenant.id, principal.user.id, params.id);
  }
}
