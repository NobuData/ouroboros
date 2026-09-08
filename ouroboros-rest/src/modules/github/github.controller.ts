/**
 * `/api/v1/settings/github-token` — the org settings surface K.3 asks for
 * ([#101](https://github.com/NobuData/ouroboros/issues/101)).
 *
 * **The workspace is the session's, never the request's** — the same sentence the settings,
 * dashboard, runs and queue controllers open with, and the same property: no `{orgId}` in the
 * path, the tenant guard resolves and membership-checks the active organization, and these
 * handlers read what it established. A workspace you are not a member of answers `404` rather
 * than `403`, which is #32's rule and not this file's to restate.
 *
 * **Every route here is an administrator's.** The `GET` carries `@Roles(...ADMINISTRATORS)`
 * as the writes do, and that is a deliberate departure from `settings.controller.ts`, whose
 * read is every member's *"a viewer is a role that exists to be able to look at the switch it
 * may not flip"*. The difference is what is being looked at. A viewer looking at the
 * auto-merge switch learns a policy; a viewer looking at this learns that a credential exists,
 * when it was set, when it was last rotated, and its last four characters. That is
 * reconnaissance rather than transparency, and the acceptance criterion — *only owner/admin
 * can set, rotate or clear* — is not weakened by also refusing the read.
 *
 * **Three routes for three verbs, and no fourth.** `PUT` sets or rotates (one token per
 * workspace, so they are one operation — the service's header argues it), `DELETE` clears,
 * `GET` reads the mask. There is no reveal: `provider-connections` has one because a person
 * has to be able to copy an API key back out for another tool, and nothing needs to copy this
 * token anywhere — Ouroboros is the only thing that uses it, and an endpoint that returned it
 * would exist purely to be the way it leaks. That is the second acceptance criterion made
 * structural: *the token is absent from every API response* is true here because no route
 * could return it.
 */

import { Body, Controller, Delete, Get, Put } from "@nestjs/common";
import { Session } from "@thallesp/nestjs-better-auth";

import type { Principal } from "../auth/principal";
import type { Organization } from "../db/schema";
import { ADMINISTRATORS, Roles } from "../tenancy/roles.guard";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import { GithubCredentialsService, type CredentialActor } from "./github.credentials.service";
import { PutGithubTokenDto } from "./github.dto";
import type { GithubTokenResource } from "./github.resources";

@Controller("settings/github-token")
@Roles(...ADMINISTRATORS)
export class GithubTokenController {
  /**
   * @param credentials - The credential's lifecycle. The controller decides nothing: it
   *   supplies who and when, and reads back what may be said.
   */
  constructor(private readonly credentials: GithubCredentialsService) {}

  /**
   * `GET /api/v1/settings/github-token` — what may be said about the stored token.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @returns The masked resource, or `configured: false`. Never a `404`: the surface always
   *   has a state to render, and the absence of a token is one of them.
   */
  @Get()
  read(@CurrentTenant() tenant: Organization): Promise<GithubTokenResource> {
    return this.credentials.read(tenant.id);
  }

  /**
   * `PUT /api/v1/settings/github-token` — store a token, or replace the one that is there.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param principal - The session, for the audit event. Read from the session rather than
   *   from the body: *who set this credential* is a fact about the request, and a body field
   *   would let a client attribute its own writes to somebody else.
   * @param body - The validated request. A value that is not shaped like a GitHub token is a
   *   `422` from the pipe naming the field — and naming only the field, never the value.
   * @returns The masked resource as it now stands. Answered rather than a bare `204`, so the
   *   surface can render `ghp_••••abcd` from the response it already has instead of following
   *   the write with a read.
   */
  @Put()
  set(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Body() body: PutGithubTokenDto,
  ): Promise<GithubTokenResource> {
    return this.credentials.set(actorOf(tenant, principal), body.token);
  }

  /**
   * `DELETE /api/v1/settings/github-token` — remove the token.
   *
   * Idempotent, and answers `200` with the resource rather than `204`: clearing a workspace
   * that had none is the request already satisfied, and the surface still needs a state to
   * render.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param principal - The session, for the audit event.
   * @returns The not-configured resource.
   */
  @Delete()
  clear(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
  ): Promise<GithubTokenResource> {
    return this.credentials.clear(actorOf(tenant, principal));
  }
}

/**
 * Who is acting, and when.
 *
 * One helper rather than three copies, and the clock is read here so that a request's row and
 * its audit event carry the same instant rather than two that differ by however long the
 * write took.
 *
 * @param tenant - The workspace, from the tenant guard.
 * @param principal - The session.
 * @returns The actor the service records.
 */
function actorOf(tenant: Organization, principal: Principal): CredentialActor {
  return { organizationId: tenant.id, actorId: principal.user.id, at: new Date() };
}
