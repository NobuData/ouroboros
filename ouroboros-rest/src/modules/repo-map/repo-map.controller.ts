/**
 * `/api/v1/knowledge/repo-map` — the skills table's **regenerate** action for `repo-map` (BF.6,
 * [#415](https://github.com/NobuData/ouroboros/issues/415)), and where each repository's map
 * stands (BG.6, [#422](https://github.com/NobuData/ouroboros/issues/422)).
 *
 * The regenerate is **administrators'**, the gate that publishing any skill version takes: a
 * regenerate may publish. The status is every member's, as the skills list is: it reads.
 */

import { Body, Controller, Get, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { Session } from "@thallesp/nestjs-better-auth";

import type { Principal } from "../auth/principal";
import type { Organization } from "../db/schema";
import { ADMINISTRATORS, Roles } from "../tenancy/roles.guard";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import { RegenerateRepoMapBody } from "./repo-map.dto";
import type { RepoMapReport, RepoMapStatusList } from "./repo-map.resources";
import { RepoMapService } from "./repo-map.service";

@Controller("knowledge/repo-map")
export class RepoMapController {
  /** @param generator - The generator. */
  constructor(private readonly generator: RepoMapService) {}

  /**
   * `GET /api/v1/knowledge/repo-map` — one status per enabled repository: `generated`, `pending`
   * its first generation, or `failed` at it, with the newest recorded generation's report.
   *
   * @param tenant - The workspace.
   * @returns The statuses, by repository name.
   */
  @Get()
  status(@CurrentTenant() tenant: Organization): Promise<RepoMapStatusList> {
    return this.generator.status(tenant.id);
  }

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
