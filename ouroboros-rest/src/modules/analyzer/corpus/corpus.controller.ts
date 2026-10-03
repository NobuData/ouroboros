/**
 * `GET /api/v1/analyzer/corpus?repo=` — how much history a repository holds, how much the analyzer
 * needs, and how much the last ended analysis read (BW.6,
 * [#521](https://github.com/NobuData/ouroboros/issues/521); the analyzer page's *needs more
 * history* and *no analysis yet* states).
 *
 * Every member may read — a viewer may read the analyzer. **The workspace is the session's, never
 * the request's**; a repository the workspace has none of reads as an empty corpus.
 */

import { Controller, Get, Query } from "@nestjs/common";

import type { Organization } from "../../db/schema";
import { CurrentTenant } from "../../tenancy/tenant.decorators";
import { CorpusStateQuery } from "./corpus.dto";
import type { CorpusStateResource } from "./corpus.resources";
import { CorpusStateService } from "./corpus.service";

@Controller("analyzer/corpus")
export class CorpusStateController {
  /** @param corpora - The read. */
  constructor(private readonly corpora: CorpusStateService) {}

  /**
   * The repository's corpus as it stands, against the floor, and as it was last analysed.
   *
   * @param tenant - The workspace.
   * @param query - `{repo}`.
   * @returns The state.
   */
  @Get()
  read(
    @CurrentTenant() tenant: Organization,
    @Query() query: CorpusStateQuery,
  ): Promise<CorpusStateResource> {
    return this.corpora.state(tenant.id, query.repo);
  }
}
