/**
 * `/api/v1/settings/integrations` — the Settings integrations grid (BR.4,
 * [#488](https://github.com/NobuData/ouroboros/issues/488)).
 *
 * ```
 * GET  /settings/integrations   every tile, composed now from the plane that owns it · *N connected*
 * ```
 *
 * **Read-only by design.** The grid has no write: a connection is made, changed and removed on
 * the surface that owns it, which each tile's `deepLink` points at. Every member reads it — it
 * names which integrations exist, never a credential or an endpoint URL.
 */

import { Controller, Get } from "@nestjs/common";

import type { Organization } from "../db/schema";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import { IntegrationsRepository } from "./integrations.repository";
import { composeIntegrations, type IntegrationsResource } from "./integrations.tiles";

@Controller("settings/integrations")
export class IntegrationsController {
  /**
   * @param integrations - The owning planes' reads.
   */
  constructor(private readonly integrations: IntegrationsRepository) {}

  /**
   * The grid.
   *
   * @param tenant - The workspace.
   * @returns Every tile and the connected count.
   */
  @Get()
  async list(@CurrentTenant() tenant: Organization): Promise<IntegrationsResource> {
    return composeIntegrations(await this.integrations.facts(tenant.id));
  }
}
