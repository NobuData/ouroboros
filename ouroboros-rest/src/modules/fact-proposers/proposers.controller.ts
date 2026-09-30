/**
 * `/api/v1/fact-proposers` — BF.3's deterministic fact proposers
 * ([#412](https://github.com/NobuData/ouroboros/issues/412)), observable.
 *
 * ```
 * GET  /api/v1/fact-proposers               the registry: kinds, versions, triggers, provenance
 * GET  /api/v1/fact-proposers/suppressions  candidates deduped against an existing fact
 * POST /api/v1/fact-proposers/backfill      run every proposer over one run's sources
 * ```
 *
 * A prefix of its own rather than `/facts/…`, so no path here can be read as a `:factId`.
 * **Members read; administrators backfill** — a backfill writes proposals on the workspace's
 * behalf, the rule-file import's gate. The proposers themselves need no route: they run when a
 * classification, waiver or steer is written (`FACT_SOURCE_OBSERVER`).
 */

import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from "@nestjs/common";

import type { Organization } from "../db/schema";
import { ADMINISTRATORS, Roles } from "../tenancy/roles.guard";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import {
  BackfillProposersBody,
  DEFAULT_SUPPRESSIONS_PAGE,
  ListSuppressionsQuery,
} from "./proposers.dto";
import {
  backfillResource,
  registryResource,
  type BackfillResource,
  type ProposerRegistryResource,
  type SuppressionList,
} from "./proposers.resources";
import { FactProposersService } from "./proposers.service";

@Controller("fact-proposers")
export class FactProposersController {
  /** @param proposers - The proposers. */
  constructor(private readonly proposers: FactProposersService) {}

  /**
   * `GET /api/v1/fact-proposers` — the registry, as data.
   *
   * @returns The registry.
   */
  @Get()
  registry(): ProposerRegistryResource {
    return registryResource();
  }

  /**
   * `GET /api/v1/fact-proposers/suppressions` — what dedupe held back, newest first.
   *
   * @param tenant - The workspace.
   * @param query - `limit`.
   * @returns The suppressions.
   */
  @Get("suppressions")
  async suppressions(
    @CurrentTenant() tenant: Organization,
    @Query() query: ListSuppressionsQuery,
  ): Promise<SuppressionList> {
    return {
      items: await this.proposers.suppressions(tenant.id, query.limit ?? DEFAULT_SUPPRESSIONS_PAGE),
    };
  }

  /**
   * `POST /api/v1/fact-proposers/backfill` — every proposer over one run's sources. Idempotent:
   * a source already proposed or suppressed answers so again and writes nothing.
   *
   * @param tenant - The workspace.
   * @param body - `runId`.
   * @returns What each source became, and the counts.
   */
  @Roles(...ADMINISTRATORS)
  @Post("backfill")
  @HttpCode(HttpStatus.OK)
  async backfill(
    @CurrentTenant() tenant: Organization,
    @Body() body: BackfillProposersBody,
  ): Promise<BackfillResource> {
    return backfillResource(body.runId, await this.proposers.backfillRun(tenant.id, body.runId));
  }
}
