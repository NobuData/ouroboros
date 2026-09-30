/**
 * `/api/v1/knowledge/repo-map` — the skills table's **regenerate** action for `repo-map` (BF.6,
 * [#415](https://github.com/NobuData/ouroboros/issues/415)).
 *
 * **Administrators'**, the gate that publishing any skill version takes: a regenerate may publish.
 */

import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { Session } from "@thallesp/nestjs-better-auth";

import type { Principal } from "../auth/principal";
import type { Organization } from "../db/schema";
import { ADMINISTRATORS, Roles } from "../tenancy/roles.guard";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import { RegenerateRepoMapBody } from "./repo-map.dto";
import type { RepoMapReport } from "./repo-map.resources";
import { RepoMapService } from "./repo-map.service";

@Controller("knowledge/repo-map")
export class RepoMapController {
  /** @param generator - The generator. */
  constructor(private readonly generator: RepoMapService) {}

  /**
   * `POST /api/v1/knowledge/repo-map/regenerate` — generate now; `200` with the report, which
   * says `unchanged` when the map is identical to the version in force.
   *
   * @param tenant - The workspace.
   * @param principal - The session — the version's publisher.
   * @param body - The repository.
   * @returns The report.
   */
  @Roles(...ADMINISTRATORS)
  @Post("regenerate")
  @HttpCode(HttpStatus.OK)
  regenerate(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Body() body: RegenerateRepoMapBody,
  ): Promise<RepoMapReport> {
    return this.generator.regenerate(tenant.id, body.repo, principal.user.id);
  }
}
