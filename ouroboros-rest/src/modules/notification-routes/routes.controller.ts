/**
 * `/api/v1/settings/notifications` — the Settings notifications card's org-level routes (BR.4,
 * [#488](https://github.com/NobuData/ouroboros/issues/488)).
 *
 * ```
 * GET    /settings/notifications          every core route (stored or default) · custom routes · channels
 * GET    /settings/notifications/:kind    one route
 * PATCH  /settings/notifications/:kind    re-bind, configure, switch — refused while locked
 * ```
 *
 * **Every member reads; administrators write.** Where the workspace's digest and pages go is an
 * `owner`/`admin` decision made for everyone — which is what distinguishes these routes from the
 * per-person preferences at `/inbox/notifications`. The workspace is the session's, never the
 * request's.
 */

import { Body, Controller, Get, Param, Patch } from "@nestjs/common";
import { Session } from "@thallesp/nestjs-better-auth";

import type { Principal } from "../auth/principal";
import type { Organization } from "../db/schema";
import { ADMINISTRATORS, Roles } from "../tenancy/roles.guard";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import { PatchNotificationRouteDto } from "./routes.dto";
import type { NotificationRouteResource, NotificationRoutesResource } from "./routes.resources";
import { NotificationRoutesService } from "./routes.service";

@Controller("settings/notifications")
export class NotificationRoutesController {
  /**
   * @param routes - The operations.
   */
  constructor(private readonly routes: NotificationRoutesService) {}

  /**
   * The card.
   *
   * @param tenant - The workspace.
   * @returns Every route with its lock derived, and every channel's availability.
   */
  @Get()
  list(@CurrentTenant() tenant: Organization): Promise<NotificationRoutesResource> {
    return this.routes.list(tenant.id);
  }

  /**
   * One route.
   *
   * @param tenant - The workspace.
   * @param kind - The route kind.
   * @returns The route, stored or its default.
   */
  @Get(":kind")
  read(
    @CurrentTenant() tenant: Organization,
    @Param("kind") kind: string,
  ): Promise<NotificationRouteResource> {
    return this.routes.read(tenant.id, kind);
  }

  /**
   * Save a route. Enabling one whose channel cannot deliver is `409 notification_route_locked`.
   *
   * @param tenant - The workspace.
   * @param principal - Who saved it — the audit actor.
   * @param kind - The route kind.
   * @param patch - The fields to change.
   * @returns The route as stored.
   */
  @Patch(":kind")
  @Roles(...ADMINISTRATORS)
  update(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Param("kind") kind: string,
    @Body() patch: PatchNotificationRouteDto,
  ): Promise<NotificationRouteResource> {
    return this.routes.update(tenant.id, principal.user.id, kind, patch);
  }
}
