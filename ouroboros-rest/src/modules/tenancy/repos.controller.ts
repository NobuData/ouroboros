/**
 * `/api/v1/tenants/{tenantId}/orgs/{login}/repos` — the repositories inside an organisation.
 *
 * Two methods, exactly as the issue lists them, and the `PATCH` is the one that also creates:
 * there is no discovery flow yet to have recorded a repository for somebody to then switch
 * on, so naming one in a `PATCH` records it. See `repos.service.ts`.
 *
 * A separate controller from `orgs.controller.ts` even though both are served by one
 * repository, because the paths nest: a repository is addressed *through* its organisation,
 * and folding both into one controller would mean a class whose routes have two different
 * shapes of parameter.
 */

import { Body, Controller, Get, Param, Patch, Query, UseInterceptors } from "@nestjs/common";

import { ConstraintViolationInterceptor } from "./constraints";
import { PageQuery, type Page } from "./pagination";
import { ADMINISTRATORS, Roles } from "./roles.guard";
import { ReposService } from "./repos.service";
import type { RepoResource } from "./resources";
import { OrgParams, RepoParams, UpdateRepoBody } from "./tenancy.dto";

@Controller("tenants/:tenantId/orgs/:login/repos")
@UseInterceptors(ConstraintViolationInterceptor)
export class ReposController {
  constructor(private readonly repos: ReposService) {}

  /**
   * `GET …/repos` — one page of this organisation's repositories, enabled or not.
   *
   * @param params - The tenant's id and the organisation's login.
   * @param query - `limit` and `offset`.
   * @returns The page.
   */
  @Get()
  list(@Param() params: OrgParams, @Query() query: PageQuery): Promise<Page<RepoResource>> {
    return this.repos.list(params.tenantId, params.login, query);
  }

  /**
   * `PATCH …/repos/{name}` — enable or disable a repository, recording it if it is new.
   *
   * @param params - The tenant's id, the organisation's login and the repository's name.
   * @param body - `enabled`, and optionally the default branch.
   * @returns The repository after the change.
   */
  @Roles(...ADMINISTRATORS)
  @Patch(":name")
  setEnabled(@Param() params: RepoParams, @Body() body: UpdateRepoBody): Promise<RepoResource> {
    return this.repos.setEnabled(params.tenantId, params.login, params.name, body);
  }
}
