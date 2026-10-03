/**
 * `GET /api/v1/analyzer/suggestions?repo=` — a repository's suggestion cards (BW.3,
 * [#518](https://github.com/NobuData/ouroboros/issues/518); mockup 18's **Suggested build-process
 * changes** and **Suggested workflow changes**, their scoring popovers and Details sheets).
 *
 * Every member may read — a viewer may read the analyzer. **The workspace is the session's, never
 * the request's**; a repository the workspace has none of reads as no suggestions. What a
 * suggestion may be *done* with is `actions/actions.controller.ts`'s.
 */

import { Controller, Get, Query } from "@nestjs/common";

import type { Organization } from "../../db/schema";
import { CurrentTenant } from "../../tenancy/tenant.decorators";
import { SuggestionsQuery } from "./suggestions.dto";
import type { SuggestionsResource } from "./suggestions.resources";
import { SuggestionsService } from "./suggestions.service";

@Controller("analyzer/suggestions")
export class SuggestionsController {
  /** @param suggestions - The read. */
  constructor(private readonly suggestions: SuggestionsService) {}

  /**
   * The build-process and workflow suggestions still current, most confident first.
   *
   * @param tenant - The workspace.
   * @param query - `{repo}`.
   * @returns The cards' content.
   */
  @Get()
  list(
    @CurrentTenant() tenant: Organization,
    @Query() query: SuggestionsQuery,
  ): Promise<SuggestionsResource> {
    return this.suggestions.list(tenant.id, query.repo, new Date());
  }
}
