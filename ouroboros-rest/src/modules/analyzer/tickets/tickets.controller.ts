/**
 * `GET /api/v1/analyzer/tickets?repo=` — a repository's drafted-tickets card (BW.4,
 * [#519](https://github.com/NobuData/ouroboros/issues/519); mockup 18's **Drafted tickets — from
 * patterns, not people**).
 *
 * Every member may read — a viewer may read the analyzer. **The workspace is the session's, never
 * the request's**; a repository the workspace has none of reads as no tickets. Drafting and
 * pushing are `actions/actions.controller.ts`'s; selecting and editing a draft are planning's own
 * routes, because a drafted ticket is an ordinary planning draft.
 */

import { Controller, Get, Query } from "@nestjs/common";

import type { Organization } from "../../db/schema";
import { CurrentTenant } from "../../tenancy/tenant.decorators";
import { TicketsQuery } from "./tickets.dto";
import type { TicketsResource } from "./tickets.resources";
import { TicketsService } from "./tickets.service";

@Controller("analyzer/tickets")
export class TicketsController {
  /** @param tickets - The read. */
  constructor(private readonly tickets: TicketsService) {}

  /**
   * The ticket suggestions nobody has drafted yet, and the planning batches the rest were
   * drafted into.
   *
   * @param tenant - The workspace.
   * @param query - `{repo}`.
   * @returns The card's content.
   */
  @Get()
  list(
    @CurrentTenant() tenant: Organization,
    @Query() query: TicketsQuery,
  ): Promise<TicketsResource> {
    return this.tickets.list(tenant.id, query.repo);
  }
}
