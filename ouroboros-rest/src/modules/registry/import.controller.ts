/**
 * `/api/v1/registry/import` — the head's **Import from provider ▾**
 * ([#587](https://github.com/NobuData/ouroboros/issues/587)).
 *
 * **The workspace is the session's, never the request's** — the sentence every controller under
 * `/api/v1` opens with. No `{orgId}` in these paths; the tenant guard resolves and
 * membership-checks the active organization, and both handlers read what it established. A
 * connection id from another workspace is a `404` here for the same reason it is everywhere:
 * the read is scoped, so the row is not there.
 *
 * **Administrators only — including the read.** This is the one registry read that carries
 * `@Roles(...ADMINISTRATORS)`, and it is deliberate rather than an oversight of the pattern
 * `aliases.controller.ts` sets. The alias *list* is a viewer's business: it is what the
 * workspace's routes are allowed to point at, and looking at it is how somebody understands a
 * chain. The candidates read is not a view of the registry at all — it is the first half of a
 * write, a form pre-filled with the names that write would use, and there is nothing in it a
 * member could act on. Gating both halves together is also what keeps the ticket's *role-gated
 * — owner/admin only* one sentence rather than two with an exception in the middle.
 *
 * **The batch answers `200` rather than `201`.** A `201` means *a resource was created and here
 * it is*, which is what `POST /registry/aliases` and its duplicate both are. This creates a
 * list — and, on a re-run, creates nothing at all while still succeeding. The answer is a
 * report of what happened to each item, so it is a `200` carrying that report; a `Location`
 * for one of N created aliases would be a header naming an arbitrary member of the batch.
 *
 * Sessions are required without anything here saying so — the global guard — and a tenant is
 * required *because* nothing here says otherwise: no `@TenantOptional()`, so a session acting
 * in no workspace is a `400 organization_required` before any handler runs.
 */

import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from "@nestjs/common";
import { Session } from "@thallesp/nestjs-better-auth";

import type { Principal } from "../auth/principal";
import type { Organization } from "../db/schema";
import { ADMINISTRATORS, Roles } from "../tenancy/roles.guard";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import { ImportAliasesDto, ImportConnectionParams } from "./import.dto";
import type { ImportCandidateListResource, ImportResultResource } from "./import.resources";
import { ImportService } from "./import.service";

@Controller("registry/import")
@Roles(...ADMINISTRATORS)
export class ImportController {
  constructor(private readonly imports: ImportService) {}

  /**
   * `GET /api/v1/registry/import/{connectionId}/candidates` — the wizard's table.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param params - Which connection to import from.
   * @returns Every model discovery has reported on it, annotated with what already names it,
   *   what to call it, what it costs and what it can do — or the explanation for why there are
   *   none.
   */
  @Get(":connectionId/candidates")
  candidates(
    @CurrentTenant() tenant: Organization,
    @Param() params: ImportConnectionParams,
  ): Promise<ImportCandidateListResource> {
    return this.imports.candidates(tenant.id, params.connectionId);
  }

  /**
   * `POST /api/v1/registry/import` — create the ticked rows, all of them or none.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param principal - The session, for `updated_by` and each revision's actor. Read from the
   *   session rather than from the body: *who imported this* is a fact about the request, and
   *   a body field would let a client attribute its own writes to somebody else.
   * @param body - The connection and the rows.
   * @returns What was created, and what was skipped for already having an alias.
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  create(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Body() body: ImportAliasesDto,
  ): Promise<ImportResultResource> {
    return this.imports.create(tenant.id, principal.user.id, body);
  }
}
