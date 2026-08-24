/**
 * `/api/v1/registry/param-schema` — what one model can be tuned with
 * ([#585](https://github.com/NobuData/ouroboros/issues/585)).
 *
 * **The workspace is the session's, never the request's** — the same sentence every controller
 * under `/api/v1` opens with. No `{orgId}` in the path, the tenant guard resolves and
 * membership-checks the active organization, and this handler reads what it established. It
 * matters here because the answer is shaped by *this workspace's* discovery and *this
 * workspace's* connection: a schema resolved out of the wrong one would offer bounds taken from
 * somebody else's deployment.
 *
 * **This is the first controller `src/modules/registry/` has declared, and decision M2 is why
 * it took until now.** Y.1 ([#189](https://github.com/NobuData/ouroboros/issues/189)) put the
 * schema and the resolution accessors here and left every management surface to mockups 07 and
 * 21 — so that those roadmaps would *write* their API rather than negotiate with one written
 * ahead of them. Mockup 21 is now being written, and this is its first route: a read, and one
 * that creates, updates and deletes nothing. The alias CRUD beside it is CH.1's
 * ([#584](https://github.com/NobuData/ouroboros/issues/584)) and lands in this module next.
 *
 * **Any member may read it, and there is no write here to gate.** A param schema is a
 * description of a model, not a workspace's data: it names no credential, no spend and no
 * alias. The route therefore carries no `@Roles()`, per the roles guard's rule that a bare
 * route is any of the four — a viewer is a role that exists to be able to look at the form
 * somebody else will fill in. What the schema *validates* is role-gated where it happens, on
 * CH.1's writes.
 *
 * Sessions are required without anything here saying so — the global guard — and a tenant is
 * required *because* nothing here says otherwise: no `@TenantOptional()`, so a session acting
 * in no workspace is a `400 organization_required` before the handler runs.
 */

import { Controller, Get, Query } from "@nestjs/common";

import type { Organization } from "../db/schema";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import { ParamSchemaQuery } from "./params.dto";
import { ParamSchemaService } from "./params.service";
import { toParamSchemaResource, type ParamSchemaResource } from "./resources";

@Controller("registry/param-schema")
export class ParamSchemaController {
  constructor(private readonly params: ParamSchemaService) {}

  /**
   * The schema the alias inspector renders its param fields from.
   *
   * **`connection` is optional, and omitting it is a question rather than a mistake.** An alias
   * created ahead of its key has a model and no provider; asking about one answers the generic
   * schema, the reason, and the registry restrictions — which is everything that is honestly
   * known about it.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param query - Which model, on which connection.
   * @returns The two schemas, the fields they render as, the reason there are no params when
   *   there are none, and the sources that shaped them.
   * @throws {NotFoundError} `404 provider_connection_not_found` when `connection` names none in
   *   this workspace — the same answer for *no such connection* and *another workspace's*.
   */
  @Get()
  async schema(
    @CurrentTenant() tenant: Organization,
    @Query() query: ParamSchemaQuery,
  ): Promise<ParamSchemaResource> {
    const connectionId = query.connection ?? null;
    const merged = await this.params.schemaFor(tenant.id, connectionId, query.model);

    return toParamSchemaResource(merged, connectionId, query.model);
  }
}
