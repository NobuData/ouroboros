/**
 * `/api/v1/settings/audit` — the Settings page's Audit Log card: the log, its today view, and its
 * CSV export (BR.2, [#486](https://github.com/NobuData/ouroboros/issues/486)).
 *
 * ```
 * GET /settings/audit             keyset-paged, filtered events
 * GET /settings/audit/today       the card's rows: time · actor · event, and `retained 400d`
 * GET /settings/audit/export.csv  a bounded range, streamed, and itself audited
 * ```
 *
 * **The workspace is the session's, never the request's** — the tenant guard resolves and
 * membership-checks it, so another workspace's history is unreachable by route rather than by
 * predicate.
 *
 * **Administrators only**, on the credential trail's argument (`audit/audit.controller.ts`): the
 * log says what colleagues did, from where. Every route here excludes `viewer`, which also makes
 * them person-only reads for service accounts (`auth/service.scopes.ts` rule 3) — a token cannot
 * extract the log that records what tokens did.
 */

import { Readable } from "node:stream";

import { Controller, Get, Query, Res, StreamableFile } from "@nestjs/common";
import { Session } from "@thallesp/nestjs-better-auth";

import type { Principal } from "../auth/principal";
import type { Organization } from "../db/schema";
import type { HeaderResponse } from "../farm/logs/logs.controller";
import { ADMINISTRATORS, Roles } from "../tenancy/roles.guard";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import { AUDIT_CSV_MEDIA_TYPE } from "./audit-plane.csv";
import { AuditExportQuery, AuditPlaneQuery, AuditTodayQuery } from "./audit-plane.dto";
import type { AuditPlanePage, AuditTodayResource } from "./audit-plane.resources";
import { AuditPlaneService } from "./audit-plane.service";

/** The header carrying the export's row count, so a client can show progress against it. */
export const AUDIT_EXPORT_ROWS_HEADER = "X-Ouro-Export-Rows";

/** An export is a person's extraction of history; no intermediary keeps a copy. */
const NO_STORE = "private, no-store";

@Controller("settings/audit")
export class AuditPlaneController {
  constructor(private readonly plane: AuditPlaneService) {}

  /**
   * The log, newest first, one keyset page at a time.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param query - Filters, `cursor` and `limit`.
   * @returns The events and `nextCursor`.
   */
  @Get()
  @Roles(...ADMINISTRATORS)
  list(
    @CurrentTenant() tenant: Organization,
    @Query() query: AuditPlaneQuery,
  ): Promise<AuditPlanePage> {
    return this.plane.list(tenant.id, query);
  }

  /**
   * The card's today view.
   *
   * @param tenant - The workspace.
   * @param query - `tz` and `limit`.
   * @returns Today's newest lines and the retention footer.
   */
  @Get("today")
  @Roles(...ADMINISTRATORS)
  today(
    @CurrentTenant() tenant: Organization,
    @Query() query: AuditTodayQuery,
  ): Promise<AuditTodayResource> {
    return this.plane.today(tenant.id, query);
  }

  /**
   * The filtered view over a bounded range, as a streamed CSV. Writes `audit.exported` before the
   * first byte.
   *
   * @param tenant - The workspace.
   * @param principal - The session — the export's audit actor.
   * @param query - The filters; `from` and `to` required, at most 366 days apart.
   * @param response - For the cache and row-count headers.
   * @returns The CSV stream.
   */
  @Get("export.csv")
  @Roles(...ADMINISTRATORS)
  async exportCsv(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Query() query: AuditExportQuery,
    @Res({ passthrough: true }) response: HeaderResponse,
  ): Promise<StreamableFile> {
    const file = await this.plane.exportCsv(tenant.id, query, principal.user.id);

    response.setHeader("Cache-Control", NO_STORE);
    response.setHeader(AUDIT_EXPORT_ROWS_HEADER, String(file.rows));

    return new StreamableFile(Readable.from(file.chunks), {
      type: AUDIT_CSV_MEDIA_TYPE,
      disposition: `attachment; filename="${file.filename}"`,
    });
  }
}
