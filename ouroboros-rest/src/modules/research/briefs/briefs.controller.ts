/**
 * `/api/v1/research/investigations/{investigationId}/…` — a brief, read (CM.2,
 * [#621](https://github.com/NobuData/ouroboros/issues/621)):
 *
 *   GET  …/brief          the card: paragraphs with claim spans and cites, the sources panel,
 *                         the capability matrix and the proposed-from-gaps summary
 *   GET  …/sources        the whole ledger behind `all ↗`, with excerpts and retrieval times
 *   GET  …/brief/export   **Export brief ↗** — the same brief as a Markdown file
 *
 * Every member reads; nothing here writes. The workspace is the session's, and an investigation
 * of another workspace is `404`.
 */

import { Controller, Get, Param, Res, StreamableFile } from "@nestjs/common";

import type { Organization } from "../../db/schema";
import type { HeaderResponse } from "../../farm/logs/logs.controller";
import { CurrentTenant } from "../../tenancy/tenant.decorators";
import { BRIEF_EXPORT_MEDIA_TYPE } from "./brief.export";
import type { BriefLedgerResource, BriefResource } from "./brief.resources";
import { InvestigationParams } from "./briefs.dto";
import { BriefsService } from "./briefs.service";

/** A brief is a workspace's own, and a new version may replace the one just read. */
const PRIVATE_NO_CACHE = "private, no-cache";

@Controller("research/investigations/:investigationId")
export class BriefsController {
  /** @param briefs - The read model and the export. */
  constructor(private readonly briefs: BriefsService) {}

  /**
   * `GET …/brief` — the investigation's current brief.
   *
   * @param tenant - The workspace.
   * @param params - The investigation.
   * @returns The brief, its sources panel, matrix and proposal.
   */
  @Get("brief")
  brief(
    @CurrentTenant() tenant: Organization,
    @Param() params: InvestigationParams,
  ): Promise<BriefResource> {
    return this.briefs.brief(tenant.id, params.investigationId);
  }

  /**
   * `GET …/sources` — the investigation's whole ledger.
   *
   * @param tenant - The workspace.
   * @param params - The investigation.
   * @returns Every record, numbered.
   */
  @Get("sources")
  sources(
    @CurrentTenant() tenant: Organization,
    @Param() params: InvestigationParams,
  ): Promise<BriefLedgerResource> {
    return this.briefs.sources(tenant.id, params.investigationId);
  }

  /**
   * `GET …/brief/export` — the brief as a Markdown attachment.
   *
   * @param tenant - The workspace.
   * @param params - The investigation.
   * @param response - For the caching header.
   * @returns The file — `attachment; filename="RS-127-brief.md"`.
   */
  @Get("brief/export")
  async export(
    @CurrentTenant() tenant: Organization,
    @Param() params: InvestigationParams,
    @Res({ passthrough: true }) response: HeaderResponse,
  ): Promise<StreamableFile> {
    const exported = await this.briefs.export(tenant.id, params.investigationId);

    response.setHeader("Cache-Control", PRIVATE_NO_CACHE);

    return new StreamableFile(Buffer.from(exported.markdown, "utf8"), {
      type: BRIEF_EXPORT_MEDIA_TYPE,
      disposition: `attachment; filename="${exported.filename}"`,
    });
  }
}
