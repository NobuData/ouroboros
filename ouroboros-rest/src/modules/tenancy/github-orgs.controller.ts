/**
 * `/api/v1/orgs/{orgId}/github-orgs` — the GitHub organisations a workspace has enabled.
 *
 * Two words called "org" meet on this path, and the path is what keeps them apart: `{orgId}`
 * is the **workspace** (`ouroboros.organization`), `github-orgs` are **GitHub's**
 * (`ouroboros.github_orgs`). Spelling the second one out in the segment rather than nesting
 * `orgs/{orgId}/orgs/{login}` is the whole of the disambiguation, and it is why
 * [#714](https://github.com/NobuData/ouroboros/issues/714) moved the route here from
 * `/tenants/{tenantId}/orgs`.
 *
 * A GitHub organisation is addressed by login rather than by id, because the login is what a
 * person types, what a URL elsewhere already carries, and what `github_orgs_org_login_key`
 * makes unique within the workspace. It is lower-case by construction (V003), so the route
 * parameter is validated against GitHub's own rule for a login before anything looks it up.
 *
 * **`@Roles(...ADMINISTRATORS)` on the mutations and not on the reads.** That is the issue's
 * second acceptance criterion — a `member` attempting a toggle gets `403` in the envelope, an
 * `owner` succeeds — and the reads carry nothing because a `viewer` is a role that exists to
 * be able to look.
 */

import { Body, Controller, Get, Param, Patch, Post, Query, UseInterceptors } from "@nestjs/common";

import { ConstraintViolationInterceptor } from "./constraints";
import { GithubOrgsService } from "./github-orgs.service";
import { PageQuery, type Page } from "./pagination";
import type { GithubOrgResource } from "./resources";
import { ADMINISTRATORS, Roles } from "./roles.guard";
import {
  CreateGithubOrgBody,
  GithubOrgParams,
  OrgParams,
  UpdateGithubOrgBody,
} from "./tenancy.dto";

@Controller("orgs/:orgId/github-orgs")
@UseInterceptors(ConstraintViolationInterceptor)
export class GithubOrgsController {
  constructor(private readonly orgs: GithubOrgsService) {}

  /**
   * `GET …/github-orgs` — one page of this workspace's organisations, enabled or not.
   *
   * @param params - The workspace's id.
   * @param query - `limit` and `offset`.
   * @returns The page.
   */
  @Get()
  list(@Param() params: OrgParams, @Query() query: PageQuery): Promise<Page<GithubOrgResource>> {
    return this.orgs.list(params.orgId, query);
  }

  /**
   * `POST …/github-orgs` — record an organisation for this workspace.
   *
   * @param params - The workspace's id.
   * @param body - The login, and whether it starts enabled. It does not, unless asked.
   * @returns The organisation as it was stored, with `201`.
   */
  @Roles(...ADMINISTRATORS)
  @Post()
  add(@Param() params: OrgParams, @Body() body: CreateGithubOrgBody): Promise<GithubOrgResource> {
    return this.orgs.add(params.orgId, body);
  }

  /**
   * `GET …/github-orgs/{login}` — one organisation.
   *
   * @param params - The workspace's id and the organisation's login.
   * @returns The organisation.
   */
  @Get(":login")
  read(@Param() params: GithubOrgParams): Promise<GithubOrgResource> {
    return this.orgs.read(params.orgId, params.login);
  }

  /**
   * `PATCH …/github-orgs/{login}` — enable or disable it. Step 2's switch.
   *
   * @param params - The workspace's id and the organisation's login.
   * @param body - `enabled`.
   * @returns The organisation after the change.
   */
  @Roles(...ADMINISTRATORS)
  @Patch(":login")
  setEnabled(
    @Param() params: GithubOrgParams,
    @Body() body: UpdateGithubOrgBody,
  ): Promise<GithubOrgResource> {
    return this.orgs.setEnabled(params.orgId, params.login, body);
  }
}
