/**
 * `/api/v1/registry/prices` — a workspace's price corrections
 * ([#586](https://github.com/NobuData/ouroboros/issues/586)).
 *
 * **The workspace is the session's, never the request's** — the same sentence the dashboard,
 * runs, queue and settings controllers open with, and load-bearing here in a way it is not
 * everywhere: the row these operations write is the one that decides what a workspace believes
 * it is being charged. No `{orgId}` in the path, the tenant guard resolves and
 * membership-checks the active organization, and these handlers read what it established.
 *
 * **The list is every member's; the corrections are an administrator's.** The `GET` carries no
 * `@Roles()`, per the roles guard's own rule that a bare route is any of the four — a viewer is
 * a role that exists to be able to look at what a workspace pays. The `PUT` and the `DELETE`
 * carry `@Roles(...ADMINISTRATORS)`, which is the ticket's *override writes are owner/admin
 * only*: a correction changes the number every spend report in this product will multiply
 * against, so it is `owner`/`admin` and the API's one `403` for everybody below.
 *
 * **One path, three verbs**, as the ticket specifies. The pair a `DELETE` addresses is in the
 * query string rather than the path because a model identifier is a vendor's string —
 * `qwen3-coder:32b`, `openai/gpt-oss-120b`, `*` — and half of those would need escaping to
 * survive a path segment.
 *
 * **There is deliberately no route that resolves a price.** Resolution is served internally,
 * through `PricingService`, and CH.5 ([#588](https://github.com/NobuData/ouroboros/issues/588))
 * is the ticket that publishes it as part of the registry table's one payload. A second
 * endpoint answering *what does this model cost* would be a second place for the answer to come
 * from, which is the exact failure this module exists to prevent.
 *
 * Sessions are required without anything here saying so — the global guard — and a tenant is
 * required *because* nothing here says otherwise: no `@TenantOptional()`, so a session acting
 * in no workspace is a `400 organization_required` before any handler runs.
 */

import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Put, Query } from "@nestjs/common";

import type { Organization } from "../db/schema";
import type { Page } from "../tenancy/pagination";
import { ADMINISTRATORS, Roles } from "../tenancy/roles.guard";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import {
  DeletePriceOverrideQuery,
  ListPriceOverridesQuery,
  PutPriceOverrideDto,
} from "./pricing.dto";
import { PricingService } from "./pricing.service";
import type { PriceOverrideResource } from "./resources";

@Controller("registry/prices")
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  /**
   * The corrections this workspace has recorded, one page at a time.
   *
   * The bundled catalog is not in this listing. It is the same snapshot for every workspace and
   * it is not something anybody here changed, so *what have we corrected* is the question this
   * answers — an empty page meaning the workspace is on the catalog's own numbers throughout.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param query - The window. Defaults per the #31 pagination convention.
   * @returns The page, ordered by provider kind then model.
   */
  @Get()
  list(
    @CurrentTenant() tenant: Organization,
    @Query() query: ListPriceOverridesQuery,
  ): Promise<Page<PriceOverrideResource>> {
    return this.pricing.listOverrides(tenant.id, query);
  }

  /**
   * Record what this workspace actually pays for one model.
   *
   * Idempotent, as `PUT` should be: the same body sent twice leaves the same single row, and
   * the second send is a re-affirmation that moves the stamps rather than a second correction.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param body - The correction. Amounts are checked against the billing mode by the pipe, so
   *   a seat row carrying a rate is a `422` naming the field rather than a constraint violation
   *   from the column.
   * @returns The correction as stored, with the cell it renders.
   */
  @Put()
  @Roles(...ADMINISTRATORS)
  save(
    @CurrentTenant() tenant: Organization,
    @Body() body: PutPriceOverrideDto,
  ): Promise<PriceOverrideResource> {
    return this.pricing.saveOverride(tenant.id, body);
  }

  /**
   * Withdraw a correction, so the bundled catalog answers for that model again.
   *
   * `204`, because there is nothing useful to say: what was removed is of no further use to the
   * client that asked for it gone, and what the price is *now* is a different question with its
   * own answer.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param query - Which correction to withdraw.
   * @returns When it is gone.
   * @throws {NotFoundError} `404 price_override_not_found` when this workspace had none for
   *   that pair. Not a silent success: a client that believed it was withdrawing a correction
   *   needs to learn that the price it is now looking at was already the catalog's.
   */
  @Delete()
  @Roles(...ADMINISTRATORS)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentTenant() tenant: Organization,
    @Query() query: DeletePriceOverrideQuery,
  ): Promise<void> {
    return this.pricing.removeOverride(tenant.id, query);
  }
}
