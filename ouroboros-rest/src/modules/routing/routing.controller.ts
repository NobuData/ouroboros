/**
 * `/api/v1/routing` — the matrix, the inspector, the rules card, and **Save routes**
 * ([#195](https://github.com/NobuData/ouroboros/issues/195)).
 *
 * **The workspace is the session's, never the request's** — the same sentence the dashboard,
 * runs, queue, settings, pricing, registry, provider-health and provider-connections
 * controllers open with. There is no `{orgId}` in these paths; the tenant guard resolves and
 * membership-checks the active organization, and these handlers read what it established.
 * That is the ticket's *organization isolation* criterion at the door, and every statement
 * behind it carries the workspace again.
 *
 * **Owners and admins write; every member reads.** The two `GET`s carry no `@Roles()`, per the
 * roles guard's own rule that a bare route is any of the four — a viewer is a role that exists
 * to be able to look at which model answers which kind of work. Everything that changes a
 * route or a rule carries `@Roles(...ADMINISTRATORS)`, which is the ticket's *owner/admin
 * write and member read enforced **server-side** on every route*: the button being hidden is
 * the least reliable part of any authorization scheme, and this is the part that is not.
 *
 * ---------------------------------------------------------------------------
 * **Why there are two ways to save a route, and why they are one implementation.**
 *
 * The mockup's editing model is staged: *"drag ⠿ to reorder fallback chains"*, then **Save
 * routes** in the page head. That is a **batch** — `PUT /api/v1/routing/routes` — and it is
 * what the page presses, what commits atomically, and what writes one `route_revisions` row
 * for the whole press.
 *
 * `PUT /api/v1/routing/routes/{taskKind}` is the same operation addressed at one row, and the
 * ticket's own diagram is written in it. It exists because a route is a resource and a client
 * editing one should be able to say so — and it is a batch of one rather than a second code
 * path, so the two cannot come to disagree about validation, about atomicity, or about what
 * gets recorded.
 *
 * ---------------------------------------------------------------------------
 * **Why `routing/providers` is not here.** Z.3 serves the health strip at
 * `/api/v1/routing/providers` from its own controller, and that separation is deliberate on
 * both sides: health is measured by a scheduler and read by a page that polls, while this is
 * configuration a person edits. They share a page and nothing else.
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
  Put,
} from "@nestjs/common";
import { Session } from "@thallesp/nestjs-better-auth";

import type { Principal } from "../auth/principal";
import type { Organization } from "../db/schema";
import { ADMINISTRATORS, Roles } from "../tenancy/roles.guard";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import { RoutingManagementService } from "./management.service";
import type {
  AliasListResource,
  EscalationRuleResource,
  RoutingMatrixResource,
  SaveRoutesResource,
} from "./resources";
import {
  CreateRuleDto,
  RoutePolicyDto,
  RuleParams,
  SaveRoutesDto,
  TaskKindParams,
  UpdateRuleDto,
  type SaveRouteDto,
} from "./routing.dto";

@Controller("routing")
export class RoutingController {
  constructor(private readonly routing: RoutingManagementService) {}

  /**
   * `GET /api/v1/routing` — the whole page: every task kind, its route and chain, and the
   * escalation rules.
   *
   * One request rather than one per card, because they are one screen: the matrix's escalation
   * column and the rules card render the same rows, and two requests would let them disagree
   * for as long as one of them was in flight.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @returns The matrix and the rules. Empty arrays for a workspace whose routing foundations
   *   have not been seeded — the page's empty state, not a failure.
   */
  @Get()
  matrix(@CurrentTenant() tenant: Organization): Promise<RoutingMatrixResource> {
    return this.routing.matrix(tenant.id);
  }

  /**
   * `GET /api/v1/routing/aliases` — the registry list AA.3's swap menus are built from.
   *
   * A read and only a read. Decision **M2** puts alias *management* in mockup 21's surface
   * (CH.1, [#584](https://github.com/NobuData/ouroboros/issues/584)); what routing needs is the
   * list, with each alias's current resolution so a menu can preview what a swap would mean.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @returns Every alias, ordered by name, unbound ones included.
   */
  @Get("aliases")
  aliases(@CurrentTenant() tenant: Organization): Promise<AliasListResource> {
    return this.routing.aliases(tenant.id);
  }

  /**
   * `PUT /api/v1/routing/routes` — one press of **Save routes**.
   *
   * `200` rather than `201`: nothing is created. Routes exist; this is what they now say.
   *
   * The whole batch commits or none of it does, and every refusal is decided before the
   * transaction opens — so a `422` here means *nothing was written*, which is what lets a
   * client re-send a corrected batch rather than work out which half landed.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param principal - The session, for `routes.updated_by` and `route_revisions.actor`. Read
   *   from the session rather than from the body: *who saved this* is a fact about the
   *   request, and a body field would let a client attribute its own writes to somebody else.
   * @param body - The routes to commit.
   * @returns The revision this save wrote — `null` when it changed nothing — and the routes as
   *   they now stand.
   */
  @Roles(...ADMINISTRATORS)
  @Put("routes")
  save(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Body() body: SaveRoutesDto,
  ): Promise<SaveRoutesResource> {
    return this.routing.save(tenant.id, principal.user.id, body.routes);
  }

  /**
   * `PUT /api/v1/routing/routes/{taskKind}` — save one route.
   *
   * A batch of one, built here and handed to the same service method. The task kind comes from
   * the path and the rest from the body, which is why {@link RoutePolicyDto} exists separately
   * from {@link SaveRouteDto}: a body that also carried a `taskKind` would let a client address
   * one route and edit another, and `forbidNonWhitelisted` refuses it rather than picking a
   * winner.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param principal - The session, as {@link save} reads it.
   * @param params - Which route.
   * @param body - The chain and the policy triple.
   * @returns The revision, and the route as it now stands — the same envelope the batch
   *   answers with, so a client has one shape to read.
   */
  @Roles(...ADMINISTRATORS)
  @Put("routes/:taskKind")
  saveOne(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Param() params: TaskKindParams,
    @Body() body: RoutePolicyDto,
  ): Promise<SaveRoutesResource> {
    const entry: SaveRouteDto = { ...body, taskKind: params.taskKind };

    return this.routing.save(tenant.id, principal.user.id, [entry]);
  }

  /**
   * `POST /api/v1/routing/rules` — the card's **+ Add rule**.
   *
   * `201`, because a resource is created.
   *
   * **A body carrying `display` is refused.** The sentence is derived from the structure
   * (decision **M5**), the DTO declares no such property, and the pipe is configured
   * `forbidNonWhitelisted` — so the answer is a `422 validation_failed` naming the field
   * rather than a value this service quietly discards.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param body - The rule.
   * @returns The rule as stored, with the sentence PostgreSQL derived from it.
   */
  @Roles(...ADMINISTRATORS)
  @Post("rules")
  addRule(
    @CurrentTenant() tenant: Organization,
    @Body() body: CreateRuleDto,
  ): Promise<EscalationRuleResource> {
    return this.routing.addRule(tenant.id, body);
  }

  /**
   * `PATCH /api/v1/routing/rules/{id}` — the card's switch, the order, or the rule itself.
   *
   * A `PATCH` rather than a `PUT`, and the mockup is the argument: the affordance on a rule row
   * is a **switch**, and *turn this one off* should not require resending a predicate and an
   * action the client has no intention of changing — nor risk rewriting them from a stale copy.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param params - Which rule.
   * @param body - What to change.
   * @returns The rule as it now stands, its sentence regenerated from whatever changed.
   */
  @Roles(...ADMINISTRATORS)
  @Patch("rules/:id")
  changeRule(
    @CurrentTenant() tenant: Organization,
    @Param() params: RuleParams,
    @Body() body: UpdateRuleDto,
  ): Promise<EscalationRuleResource> {
    return this.routing.changeRule(tenant.id, params.id, body);
  }

  /**
   * `DELETE /api/v1/routing/rules/{id}` — remove a rule.
   *
   * `204`, and no body: there is nothing to say about a row that no longer exists, and a `200`
   * carrying the deleted resource invites a client to keep using it — the same sentence
   * `domains.controller.ts` and `provider-connections.controller.ts` open their own deletes
   * with.
   *
   * Deleting rather than switching off is a real distinction and both exist: `enabled: false`
   * keeps the rule's place in the order and the sentence the card greys out, so it can be
   * switched back on exactly where it was. This is for a rule that was a mistake.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param params - Which rule.
   * @returns When it is gone.
   */
  @Roles(...ADMINISTRATORS)
  @Delete("rules/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  removeRule(@CurrentTenant() tenant: Organization, @Param() params: RuleParams): Promise<void> {
    return this.routing.removeRule(tenant.id, params.id);
  }
}
