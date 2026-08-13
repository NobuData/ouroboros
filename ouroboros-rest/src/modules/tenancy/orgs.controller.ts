/**
 * `/api/v1/orgs` — the workspaces the signed-in person belongs to.
 *
 * The Step 2 row model (`docs/mockups/01-login.html`), and the root of every other path in
 * this module: domains are `…/orgs/{orgId}/domains`, GitHub organisations are
 * `…/orgs/{orgId}/github-orgs/{login}`, and repositories hang off those.
 *
 * **There is no `POST`, `PATCH` or `DELETE` here, and their absence is the design.** Creating
 * a workspace is `POST /api/auth/organization/create`, renaming one is the plugin's `update`,
 * and switching into one is `POST /api/auth/organization/set-active` — all served by
 * BetterAuth since [#704](https://github.com/NobuData/ouroboros/issues/704). This service
 * adding its own would be a second write path to `organization` and `member`, which is how two
 * role checks drift apart. What is left is the one thing the plugin cannot answer: the
 * workspace *with its enablement counts and the caller's role in it*, in a single request.
 */

import { Controller, Get, Query, UseInterceptors } from "@nestjs/common";

import { ConstraintViolationInterceptor } from "./constraints";
import { OrgsService } from "./orgs.service";
import { PageQuery, type Page } from "./pagination";
import type { OrgRowResource } from "./resources";
import { TenantOptional } from "./tenant.decorators";

@Controller("orgs")
@UseInterceptors(ConstraintViolationInterceptor)
export class OrgsController {
  constructor(private readonly orgs: OrgsService) {}

  /**
   * `GET /orgs` — one page of the caller's workspaces, oldest first.
   *
   * `@TenantOptional()` and nothing else: the tenant guard would otherwise demand a workspace
   * before answering *which workspaces are yours*, which is circular, and the authentication
   * guard still applies — this is the caller's own listing, scoped to them in the service.
   * There is no `@Roles()` either, and there is nothing for one to say: every row is a
   * workspace the caller is already a member of, and what they hold there is a field of the
   * answer rather than a condition on it.
   *
   * @param query - `limit` and `offset`.
   * @returns The page. Somebody who belongs to nothing yet gets an empty one, which is the
   *   `no-workspace` state Step 2 draws rather than a failure.
   */
  @TenantOptional()
  @Get()
  list(@Query() query: PageQuery): Promise<Page<OrgRowResource>> {
    return this.orgs.list(query);
  }
}
