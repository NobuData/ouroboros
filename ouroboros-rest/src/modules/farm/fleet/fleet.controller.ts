/**
 * `GET /api/v1/farm` — mockup 08, in one request.
 *
 * AH.6 ([#254](https://github.com/NobuData/ouroboros/issues/254)). What AI.1
 * ([#256](https://github.com/NobuData/ouroboros/issues/256)) mounts the page from and AI.2
 * ([#257](https://github.com/NobuData/ouroboros/issues/257)) refreshes.
 *
 * **The workspace is the session's, never the request's** — the same sentence every
 * controller in this service opens with, because it is the same property: no `{orgId}` in the
 * path, the tenant guard resolves and membership-checks the active organization, and this
 * handler reads what it established.
 *
 * ---------------------------------------------------------------------------
 * **No `@Roles()`, and that is the read half of the issue's role gate.**
 *
 * A route with no `@Roles()` is open to every member of the workspace, a `viewer` included —
 * `tenancy/roles.guard.ts` argues that a viewer is a role that exists in order to be able to
 * look. The fleet is what a workspace's builds run on, and watching it is looking. Every
 * *mutation* in this module carries `@Roles(...ADMINISTRATORS)`, which is the other half.
 *
 * Nothing on this payload is a secret. There is no token value, no envelope and no private
 * key on any resource `fleet.resources.ts` defines, and `security_mode` is published on
 * purpose so a degraded connection renders as degraded rather than as a green shield. The
 * certificate reference a runner carries since AI.5
 * ([#260](https://github.com/NobuData/ouroboros/issues/260)) is a serial and two dates: a
 * serial is public by construction — it travels in every handshake and is already in the
 * `runner.enrolled` audit event — and neither the fingerprint nor any key material is here.
 */

import { Controller, Get, Res } from "@nestjs/common";
import type { Response } from "express";

import type { Organization } from "../../db/schema";
import { POLL_AFTER } from "../../dashboard/dashboard.controller";
import { CurrentTenant } from "../../tenancy/tenant.decorators";
import { FARM_POLL_SECONDS } from "./fleet.policy";
import type { FarmResource } from "./fleet.resources";
import { FleetService } from "./fleet.service";

@Controller("farm")
export class FleetController {
  /** @param fleet - The page. */
  constructor(private readonly fleet: FleetService) {}

  /**
   * Everything mockup 08 reads.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param response - For the polling headers, set once there is a payload.
   * @returns The stat row, the fleet, the pools and the live build.
   */
  @Get()
  async page(
    @CurrentTenant() tenant: Organization,
    @Res({ passthrough: true }) response: Response,
  ): Promise<FarmResource> {
    const payload = await this.fleet.page(tenant.id);

    // Set here rather than by `@Header()`: a decorator's headers are on the response before
    // the handler runs, so a refusal would go out advertising a poll interval for a payload
    // it never produced — `installer.controller.ts` avoids the decorator for the same reason.
    //
    // **Never cached.** Every figure on this page is a claim about the present, and a
    // revalidating cache would let a proxy answer *4/5 runners online* about a minute ago.
    response.setHeader("Cache-Control", "no-store");
    response.setHeader(POLL_AFTER, String(FARM_POLL_SECONDS));

    return payload;
  }
}
