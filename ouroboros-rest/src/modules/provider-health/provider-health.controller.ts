/**
 * `/api/v1/routing/providers` — the strip payload
 * ([#196](https://github.com/NobuData/ouroboros/issues/196)).
 *
 * **The workspace is the session's, never the request's** — the same sentence the dashboard,
 * runs, queue, settings and pricing controllers open with. No `{orgId}` in the path, the
 * tenant guard resolves and membership-checks the active organization, and this handler reads
 * what it established.
 *
 * **Any member may read it.** No `@Roles()`, per the roles guard's rule that a bare route is
 * any of the four: *is Ollama up* is the kind of thing a viewer exists to be able to look at,
 * and the page it decorates is readable by every role.
 *
 * **It is a read and only a read.** Nothing here triggers a check. A "refresh" button that
 * probed on demand would be a way for anybody with a session to make this service issue
 * outbound requests at whatever rate they can click, which is a small denial-of-service
 * against a vendor's rate limit signed with the workspace's own credential. The cadence is
 * the scheduler's, the page polls, and what it gets is what the last sweep found.
 *
 * **Why `routing/` rather than `providers/`.** `/api/v1/providers` is mockup 07's CRUD surface
 * (decision **M2** — creating and editing connections is that roadmap's, not this one's), and
 * a health strip that had squatted on the collection root would be the thing 07 had to
 * negotiate with. This route is named for the page it serves: the strip at the top of mockup
 * 06, beside the matrix Z.2 ([#195](https://github.com/NobuData/ouroboros/issues/195)) serves
 * at `/api/v1/routing`.
 *
 * Sessions are required without anything here saying so — the global guard — and a tenant is
 * required *because* nothing here says otherwise: no `@TenantOptional()`, so a session acting
 * in no workspace is a `400 organization_required` before the handler runs.
 */

import { Controller, Get } from "@nestjs/common";

import type { Organization } from "../db/schema";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import { ProviderHealthService } from "./provider-health.service";
import type { ProviderHealthStripResource } from "./resources";

@Controller("routing/providers")
export class ProviderHealthController {
  constructor(private readonly health: ProviderHealthService) {}

  /**
   * Every provider this workspace has, and what is honestly known about each.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @returns The chips, ordered by name. Empty for a workspace that has configured no
   *   providers — the page's empty state, not a failure.
   */
  @Get()
  list(@CurrentTenant() tenant: Organization): Promise<ProviderHealthStripResource> {
    return this.health.strip(tenant.id);
  }
}
