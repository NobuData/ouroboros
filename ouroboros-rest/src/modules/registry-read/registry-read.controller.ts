/**
 * `GET /api/v1/registry` — mockup 21's table, composed
 * ([#588](https://github.com/NobuData/ouroboros/issues/588)).
 *
 * **The workspace is the session's, never the request's** — the sentence every controller under
 * `/api/v1` opens with. No `{orgId}` in the path; the tenant guard resolves and
 * membership-checks the active organization, and the handler reads what it established. A
 * cross-workspace read therefore returns *nothing* rather than a refusal: the read is scoped,
 * so the rows are not there.
 *
 * **Any member may read it.** The route carries no `@Roles()`, per the roles guard's rule that
 * a bare route is any of the four — a viewer is a role that exists to be able to look at which
 * models a workspace allows. There is no write here to gate: every write mockup 21 can make is
 * CH.1's ([#584](https://github.com/NobuData/ouroboros/issues/584)) and carries
 * `@Roles(...ADMINISTRATORS)` there.
 *
 * **This does not supersede `/api/v1/registry/aliases`, and does not duplicate it.** CH.1's
 * list is the *alias's* resource — the row as stored, with its revisions' provenance — and it
 * is what a write answers with. This is the *page's* payload: the same rows with four derived
 * cells composed onto them (chips, health, price, monogram) and the masked key the inspector's
 * provider line shows. It is built **on** that list rather than beside it, so there is one
 * definition of what an alias is; see `registry-read.service.ts`.
 *
 * **The path is exact.** `@Get()` on a `registry` controller matches `/api/v1/registry` and
 * nothing under it, so the four `registry/…` surfaces already mounted — `param-schema`,
 * `prices`, `aliases`, `import` — are unaffected wherever this module is registered in
 * `app.module.ts`.
 *
 * Sessions are required without anything here saying so — the global guard — and a tenant is
 * required *because* nothing here says otherwise: no `@TenantOptional()`, so a session acting
 * in no workspace is a `400 organization_required` before the handler runs.
 */

import { Controller, Get } from "@nestjs/common";

import type { Organization } from "../db/schema";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import type { RegistryReadModelResource } from "./registry-read.resources";
import { RegistryReadService } from "./registry-read.service";

@Controller("registry")
export class RegistryReadController {
  constructor(private readonly registry: RegistryReadService) {}

  /**
   * `GET /api/v1/registry` — every cell of the allowed-models table, in one payload.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @returns Every alias, ordered by name, with its binding, chips, health, price and
   *   references. **No provider is called** to answer this — see `alias.health.ts`.
   */
  @Get()
  read(@CurrentTenant() tenant: Organization): Promise<RegistryReadModelResource> {
    return this.registry.read(tenant.id);
  }
}
