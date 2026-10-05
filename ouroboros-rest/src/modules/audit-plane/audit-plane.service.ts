/**
 * The audit plane — the log every plane writes, made readable (BR.2,
 * [#486](https://github.com/NobuData/ouroboros/issues/486); delivers the surface #26 deferred).
 *
 * ```
 * list    filters ─▶ keyset page ─▶ events + nextCursor          GET /settings/audit
 * today   local midnight ─▶ newest N ─▶ time · actor · event      GET /settings/audit/today
 * export  bounded range ─▶ count ─▶ audit.exported ─▶ CSV stream  GET /settings/audit/export.csv
 * ```
 *
 * **One filter, three readers.** The query string becomes an `AuditPlaneFilter` in exactly one
 * place ({@link AuditPlaneService.filterOf}), and the list and the export page through the same
 * repository statement and render through the same resource function — so the CSV equals the
 * filtered view row for row by construction.
 *
 * **Export is a privileged read, so exporting is an audited act — recorded before the first
 * byte.** The export counts what it is about to send, writes `audit.exported` with the range, the
 * filters and that count, and only then streams. A failure to record refuses the export (AD.4's
 * posture: an operation the trail cannot record is one that does not happen), and a client that
 * disconnects half-way still left its row. The range's end is clamped to the request's instant, so
 * the export's own `audit.exported` row is never inside the range it describes.
 *
 * **It streams.** {@link AuditPlaneService.exportCsv} answers an async iterable that reads one keyset
 * batch at a time; the controller wraps it in a `Readable`, which pulls the next batch only when
 * the socket has drained the last. Memory is one batch, whatever the range.
 */

import { Injectable } from "@nestjs/common";

import { AuditService } from "../audit/audit.service";
import { AUDIT_EXPORTED_EVENT } from "../audit/audit.events";
import { startOfDay } from "../dashboard/windows";
import { RetentionPolicyService } from "../retention/retention.service";
import { decodeCursor, encodeCursor, type AuditCursor } from "./audit-plane.cursor";
import { csvHeader, csvLine } from "./audit-plane.csv";
import {
  AUDIT_PAGE_DEFAULT,
  AUDIT_TODAY_DEFAULT,
  AUDIT_TODAY_DEFAULT_ZONE,
  type AuditExportQuery,
  type AuditPlaneFilterQuery,
  type AuditPlaneQuery,
  type AuditTodayQuery,
} from "./audit-plane.dto";
import {
  AUDIT_EXPORT_MAX_DAYS,
  auditCursorInvalid,
  auditExportRangeRequired,
  auditExportRangeTooLong,
  auditRangeInvalid,
  auditReferenceInvalid,
} from "./audit-plane.errors";
import {
  filterFacts,
  parseActionFilter,
  parseReference,
  type AuditPlaneFilter,
} from "./audit-plane.filter";
import { AuditPlaneRepository } from "./audit-plane.repository";
import {
  auditPlaneEventResource,
  auditTodayRow,
  clockIn,
  type AuditPlanePage,
  type AuditTodayResource,
} from "./audit-plane.resources";

/** How many events the export reads per statement — and the most it holds in memory. */
export const AUDIT_EXPORT_BATCH = 500;

/** A day, in milliseconds. */
const DAY_MS = 86_400_000;

/** A streamed export: its file name, its row count, and its text. */
export interface AuditExport {
  /** `audit-2026-07-01-2026-10-01.csv`. */
  readonly filename: string;
  /** The rows it carries — the count `audit.exported` recorded. */
  readonly rows: number;
  /** The CSV, header first, one chunk per batch. */
  readonly chunks: AsyncIterable<string>;
}

@Injectable()
export class AuditPlaneService {
  /**
   * @param repository - The plane's reads.
   * @param audit - The trail's writer, for `audit.exported`.
   * @param retention - The `audit` tier, for the card's `retained 400d`.
   */
  constructor(
    private readonly repository: AuditPlaneRepository,
    private readonly audit: AuditService,
    private readonly retention: RetentionPolicyService,
  ) {}

  /**
   * The current instant — a method so a spec can pin it.
   *
   * @returns Now.
   */
  now(): Date {
    return new Date();
  }

  /**
   * One keyset page of the workspace's log, newest first.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param query - The validated query string.
   * @returns The events and the next page's cursor.
   * @throws {InvalidRequestError} `422` for an inverted range, a foreign cursor or a bad `pr:`.
   */
  async list(organizationId: string, query: AuditPlaneQuery): Promise<AuditPlanePage> {
    const filter = this.filterOf(query);
    const after = query.cursor === undefined ? undefined : this.cursorOf(query.cursor);
    const limit = query.limit ?? AUDIT_PAGE_DEFAULT;

    // One more than shown: its presence is the next page's existence, without a count.
    const rows = await this.repository.page(organizationId, filter, after, limit + 1);
    const shown = rows.slice(0, limit);
    const last = shown.at(-1);

    return {
      items: shown.map(auditPlaneEventResource),
      nextCursor:
        rows.length > limit && last !== undefined
          ? encodeCursor({ at: last.cursor_at, id: last.id })
          : null,
      limit,
    };
  }

  /**
   * The card's today view — today's newest events in the requested zone, and the retention footer.
   *
   * @param organizationId - The workspace.
   * @param query - The zone and the line count.
   * @returns The lines, newest first.
   */
  async today(organizationId: string, query: AuditTodayQuery): Promise<AuditTodayResource> {
    const timeZone = query.tz ?? AUDIT_TODAY_DEFAULT_ZONE;
    const limit = query.limit ?? AUDIT_TODAY_DEFAULT;
    const since = startOfDay(this.now(), timeZone);

    const [rows, retainedDays] = await Promise.all([
      this.repository.page(organizationId, { from: since }, undefined, limit + 1),
      this.retention.daysFor(organizationId, "audit"),
    ]);
    const clock = clockIn(timeZone);

    return {
      timeZone,
      since: since.toISOString(),
      rows: rows.slice(0, limit).map((row) => auditTodayRow(row, clock)),
      more: rows.length > limit,
      retainedDays,
    };
  }

  /**
   * Start a CSV export: check the range, count it, record `audit.exported`, then hand back the
   * stream. See this file's header on why the record comes first.
   *
   * @param organizationId - The workspace.
   * @param query - The filters, with `from` and `to` required.
   * @param actorId - The person exporting — the `audit.exported` actor.
   * @returns The file name, the row count, and the CSV chunks.
   * @throws {InvalidRequestError} `422 audit_export_range_required | audit_range_invalid |
   *   audit_export_range_too_long`, and the list's refusals.
   * @throws Whatever recording threw — no row, no export.
   */
  async exportCsv(
    organizationId: string,
    query: AuditExportQuery,
    actorId: string,
  ): Promise<AuditExport> {
    if (query.from === undefined) throw auditExportRangeRequired("from");
    if (query.to === undefined) throw auditExportRangeRequired("to");

    const now = this.now();
    const requested = this.filterOf(query);
    const from = requested.from as Date;
    const to = requested.to as Date;

    if (to.getTime() - from.getTime() > AUDIT_EXPORT_MAX_DAYS * DAY_MS) {
      throw auditExportRangeTooLong();
    }

    // Nothing after the request can be in it — including the row this export is about to write.
    const filter: AuditPlaneFilter = { ...requested, to: to > now ? now : to };
    const rows = await this.repository.count(organizationId, filter);

    await this.audit.record({
      organizationId,
      actorId,
      action: AUDIT_EXPORTED_EVENT,
      subjectType: "workspace",
      subjectId: organizationId,
      at: now,
      detail: { ...filterFacts(filter), rows },
    });

    return {
      filename: `audit-${day(from)}-${day(filter.to as Date)}.csv`,
      rows,
      chunks: this.csvChunks(organizationId, filter),
    };
  }

  /**
   * The export's text: the header, then each keyset batch as lines — read one batch at a time,
   * only when the consumer asks for the next.
   *
   * @param organizationId - The workspace.
   * @param filter - The export's filter, range clamped.
   * @yields The header, then one chunk per non-empty batch.
   */
  private async *csvChunks(
    organizationId: string,
    filter: AuditPlaneFilter,
  ): AsyncGenerator<string> {
    yield csvHeader();

    let after: AuditCursor | undefined;

    for (;;) {
      const rows = await this.repository.page(organizationId, filter, after, AUDIT_EXPORT_BATCH);
      const last = rows.at(-1);

      if (last === undefined) return;

      yield rows.map((row) => csvLine(auditPlaneEventResource(row))).join("");

      if (rows.length < AUDIT_EXPORT_BATCH) return;
      after = { at: last.cursor_at, id: last.id };
    }
  }

  /**
   * The one place a query string becomes a filter.
   *
   * @param query - The validated filters.
   * @returns The structured filter.
   * @throws {InvalidRequestError} `422 audit_range_invalid` when `to` is not after `from`;
   *   `422 audit_reference_invalid` for a `pr:` that names no number.
   */
  filterOf(query: AuditPlaneFilterQuery): AuditPlaneFilter {
    const from = query.from === undefined ? undefined : new Date(query.from);
    const to = query.to === undefined ? undefined : new Date(query.to);

    if (from !== undefined && to !== undefined && to <= from) throw auditRangeInvalid();

    const ref = query.ref === undefined ? undefined : parseReference(query.ref);
    if (query.ref !== undefined && ref === undefined) throw auditReferenceInvalid();

    return {
      from,
      to,
      actorKind: query.actorKind,
      actorId: query.actorId,
      actorService: query.actorService,
      ...(query.action === undefined ? {} : parseActionFilter(query.action)),
      ref,
    };
  }

  /**
   * Decode a client's cursor.
   *
   * @param token - The `nextCursor` it was given.
   * @returns The position.
   * @throws {InvalidRequestError} `422 audit_cursor_invalid`.
   */
  private cursorOf(token: string): AuditCursor {
    const cursor = decodeCursor(token);
    if (cursor === undefined) throw auditCursorInvalid();
    return cursor;
  }
}

/**
 * An instant's UTC date, for a file name.
 *
 * @param at - The instant.
 * @returns `2026-10-01`.
 */
function day(at: Date): string {
  return at.toISOString().slice(0, 10);
}
