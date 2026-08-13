/**
 * `/api/v1/orgs/{orgId}/github-orgs/{login}/repos` — the repositories inside a GitHub
 * organisation.
 *
 * Three methods, and the `PATCH` is the one that also creates: there is no discovery flow yet
 * to have recorded a repository for somebody to then switch on, so naming one in a `PATCH`
 * records it. See `repos.service.ts`.
 *
 * A separate controller from `github-orgs.controller.ts` even though both are served by one
 * repository, because the paths nest: a repository is addressed *through* its organisation,
 * and folding both into one controller would mean a class whose routes have two different
 * shapes of parameter.
 */

import { Body, Controller, Get, Param, Patch, Query, UseInterceptors } from "@nestjs/common";

import { ConstraintViolationInterceptor } from "./constraints";
import { PageQuery, type Page } from "./pagination";
import { ReposService } from "./repos.service";
import type { RepoResource } from "./resources";
import { ADMINISTRATORS, Roles } from "./roles.guard";
import { GithubOrgParams, RepoParams, UpdateRepoBody } from "./tenancy.dto";

@Controller("orgs/:orgId/github-orgs/:login/repos")
@UseInterceptors(ConstraintViolationInterceptor)
export class ReposController {
  constructor(private readonly repos: ReposService) {}

  /**
   * `GET …/repos` — one page of this organisation's repositories, enabled or not.
   *
   * @param params - The workspace's id and the organisation's login.
   * @param query - `limit` and `offset`.
   * @returns The page.
   */
  @Get()
  list(@Param() params: GithubOrgParams, @Query() query: PageQuery): Promise<Page<RepoResource>> {
    return this.repos.list(params.orgId, params.login, query);
  }

  /**
   * `GET …/repos/{name}` — one repository.
   *
   * @param params - The workspace's id, the organisation's login and the repository's name.
   * @returns The repository.
   */
  @Get(":name")
  read(@Param() params: RepoParams): Promise<RepoResource> {
    return this.repos.read(params.orgId, params.login, params.name);
  }

  /**
   * `PATCH …/repos/{name}` — enable or disable a repository, recording it if it is new.
   *
   * @param params - The workspace's id, the organisation's login and the repository's name.
   * @param body - `enabled`, and optionally the default branch.
   * @returns The repository after the change.
   */
  @Roles(...ADMINISTRATORS)
  @Patch(":name")
  setEnabled(@Param() params: RepoParams, @Body() body: UpdateRepoBody): Promise<RepoResource> {
    return this.repos.setEnabled(params.orgId, params.login, params.name, body);
  }
}
