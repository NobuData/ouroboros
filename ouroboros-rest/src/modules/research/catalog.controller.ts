/**
 * `GET /api/v1/research/kinds` and `GET /api/v1/research/tools` — what the composer is built
 * from (CN.2, [#628](https://github.com/NobuData/ouroboros/issues/628)).
 *
 * Two reads, open to every member: a kind's name and hue are not secrets, and the chips a
 * viewer cannot press should still be the chips. The workspace is the session's; the tool
 * catalog is the installation's and names no workspace at all.
 */

import { Controller, Get } from "@nestjs/common";

import type { Organization } from "../db/schema";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import { ResearchCatalogService } from "./catalog.service";
import type { InvestigationKindCatalogResource, ResearchToolCatalogResource } from "./resources";

@Controller("research")
export class ResearchCatalogController {
  /** @param catalog - The two catalogs. */
  constructor(private readonly catalog: ResearchCatalogService) {}

  /**
   * `GET …/kinds` — the workspace's investigation kinds.
   *
   * @param tenant - The session's workspace.
   * @returns Its kinds, in the composer's order.
   */
  @Get("kinds")
  kinds(@CurrentTenant() tenant: Organization): Promise<InvestigationKindCatalogResource> {
    return this.catalog.kinds(tenant.id);
  }

  /**
   * `GET …/tools` — the research tools this installation answers to.
   *
   * @returns Every tool, in the composer's order, each saying whether it is connected.
   */
  @Get("tools")
  tools(): Promise<ResearchToolCatalogResource> {
    return this.catalog.tools();
  }
}
