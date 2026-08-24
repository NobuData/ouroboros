/**
 * `GET /api/v1/providers/audit` — the credential trail
 * ([#225](https://github.com/NobuData/ouroboros/issues/225)).
 *
 * **The workspace is the session's, never the request's** — the sentence every tenant-scoped
 * controller in this service opens with, and load-bearing here for its own reason: an event
 * says who revealed which credential, when, and from where. There is no `{orgId}` in this
 * path; the tenant guard resolves and membership-checks the active organization, and this
 * handler reads what it established. That is what makes *another organization's events are
 * unreachable* a property of the route rather than of a predicate somebody remembered.
 *
 * **Administrators only, and this is the one read in the providers surface that is.**
 * `provider-connections.controller.ts` leaves its two `GET`s bare — a viewer is a role that
 * exists to be able to look at which providers a workspace has, and every field they see is
 * masked. This read is a different kind of thing. *Maya revealed the Anthropic key at 14:02
 * from 198.51.100.61* is not a fact about the workspace's configuration; it is a fact about a
 * colleague, and a trail of it is what an audit surface exists to put in front of the people
 * accountable for the workspace rather than in front of everybody in it. Mockup 07 agrees by
 * placement: **Audit log** sits in the page head beside **+ Add provider**, among the
 * administrative actions.
 *
 * ---------------------------------------------------------------------------
 * **Why this controller declares `providers` and lives in its own module.** The path has to
 * be `/api/v1/providers/audit` — AD.4's scope names it — and `providers/{id}` already exists.
 * A router matches in registration order, so `audit` must be declared before `{id}` or a
 * request for the trail is a request for a connection whose id is the word *audit*, refused
 * as a `422` by `ConnectionParams`. `app.module.ts` imports `AuditModule` before
 * `ProviderConnectionsModule` for exactly that reason and says so; `audit.integration-spec.ts`
 * asserts the consequence rather than the ordering, which is what keeps the guarantee when
 * somebody sorts the import list.
 *
 * Sessions are required without anything here saying so — the global guard — and a tenant is
 * required *because* nothing here says otherwise: no `@TenantOptional()`, so a session acting
 * in no workspace is a `400 organization_required` before the handler runs.
 */

import { Controller, Get, Query } from "@nestjs/common";

import type { Organization } from "../db/schema";
import type { Page } from "../tenancy/pagination";
import { ADMINISTRATORS, Roles } from "../tenancy/roles.guard";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import { ListAuditQuery } from "./audit.dto";
import type { AuditEventResource } from "./audit.resources";
import { AuditService } from "./audit.service";

@Controller("providers")
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  /**
   * `GET /api/v1/providers/audit` — this workspace's credential trail, newest first.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param query - The filters and the window. Defaults per the #31 pagination convention;
   *   an empty query string is *the most recent events*, which is what the sheet asks for.
   * @returns The page, ordered by instant then id.
   */
  @Get("audit")
  @Roles(...ADMINISTRATORS)
  list(
    @CurrentTenant() tenant: Organization,
    @Query() query: ListAuditQuery,
  ): Promise<Page<AuditEventResource>> {
    return this.audit.list(tenant.id, query);
  }
}
