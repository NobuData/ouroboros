/**
 * `GET /api/v1/research/kinds` and `GET /api/v1/research/tools` — what the composer is built
 * from (CN.2, [#628](https://github.com/NobuData/ouroboros/issues/628)).
 *
 * Two reads, open to every member: a kind's name and hue are not secrets, and the chips a
 * viewer cannot press should still be the chips. The workspace is the session's: the tool
 * catalog is the installation's, and each tool's sub-line, health and settings are the
 * workspace's (CN.3, [#629](https://github.com/NobuData/ouroboros/issues/629)).
 *
 * `PUT …/tools/:slug` is the enable flow's save. It stores a credential, so it is an
 * administrator's, and a person's — never a service token's.
 */

import { Body, Controller, Get, Param, Put } from "@nestjs/common";
import { Session } from "@thallesp/nestjs-better-auth";

import type { Principal } from "../auth/principal";
import { HumanOnly } from "../auth/service.scopes";
import type { Organization } from "../db/schema";
import { ADMINISTRATORS, Roles } from "../tenancy/roles.guard";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import { EnableToolDto, ToolParams } from "./catalog.dto";
import { ResearchCatalogService } from "./catalog.service";
import type {
  InvestigationKindCatalogResource,
  ResearchToolCatalogEntryResource,
  ResearchToolCatalogResource,
} from "./resources";

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
   * `GET …/tools` — the research tools this installation answers to, as the workspace sees them.
   *
   * @param tenant - The session's workspace.
   * @returns Every tool, in the composer's order, each with its live sub-line, its health dot
   *   and what its **enable** opens.
   */
  @Get("tools")
  tools(@CurrentTenant() tenant: Organization): Promise<ResearchToolCatalogResource> {
    return this.catalog.tools(tenant.id);
  }

  /**
   * `PUT …/tools/:slug` — store the workspace's settings for a tool.
   *
   * @param tenant - The session's workspace.
   * @param principal - Who is saving.
   * @param params - The tool.
   * @param body - The submitted form, in the tool's `configSchema()` vocabulary.
   * @returns The tool's row as it now reads.
   */
  @Put("tools/:slug")
  @Roles(...ADMINISTRATORS)
  @HumanOnly()
  enable(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Param() params: ToolParams,
    @Body() body: EnableToolDto,
  ): Promise<ResearchToolCatalogEntryResource> {
    return this.catalog.enable(tenant.id, params.slug, body.config, principal.user.id);
  }
}
