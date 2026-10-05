/**
 * The workspace audit log's reads — mockup 17's **Audit Log** card
 * ([#486](https://github.com/NobuData/ouroboros/issues/486) built them, BS.5
 * [#495](https://github.com/NobuData/ouroboros/issues/495) draws them).
 *
 * Two reads under `/api/v1/settings/audit`:
 *
 * - `/today` — the card's own view: today's newest events as `time · actor · event` lines, and
 *   the `audit` retention tier its footer prints (`retained 400d`).
 * - `/` — the whole log, newest first, filtered on indexed columns and **keyset-paged**: a
 *   cursor is the last row's exact position, so events that arrive while somebody pages appear
 *   before page one and never duplicate or skip a row on the pages after it.
 *
 * The third operation, the CSV export, is a streamed file rather than a JSON body, so it does not
 * go through the typed client — `app/api/settings-audit-export.ts` passes it through.
 *
 * **Owners and admins only**, all of it: an event says who did what, when, and from where. A
 * `403` reaching this layer is a state to render, not a bug.
 *
 * Server-side only, by way of `app/api/server.ts`.
 */

import { type ApiClient, unwrap } from "@/app/api/client";
import type { components } from "@/app/api/schema";
import { api } from "@/app/api/server";

/** The card's today view, and its retention footer. */
export type AuditToday = components["schemas"]["AuditToday"];
/** One line of the card — `14:31 · ouroboros-app[bot] · pushed PR #514 rev 2`. */
export type AuditTodayRow = components["schemas"]["AuditTodayRow"];
/** One event of the log, with the actor and the sentence composed from its typed facts. */
export type AuditLogEvent = components["schemas"]["AuditPlaneEvent"];
/** One keyset page of the log, newest first. */
export type AuditLogPage = components["schemas"]["AuditPlanePage"];
/** Who acted: a person, the bot, a service account, or the system. */
export type AuditActorKind = components["schemas"]["AuditActorKind"];

/**
 * What the log may be narrowed by. Every field is optional, and they combine with *and*.
 *
 * The same shape the CSV export takes, which is what makes *the export matches the filtered
 * view* a property of one object rather than of two forms kept in step.
 */
export interface AuditLogFilter {
  /** Events at or after this instant — ISO-8601 with a zone. */
  readonly from?: string;
  /** Events strictly before this instant — ISO-8601 with a zone. */
  readonly to?: string;
  /** One kind of actor. */
  readonly actorKind?: AuditActorKind;
  /** One person — their user id. */
  readonly actorId?: string;
  /** One service account (`devops-bot`) or the bot (`ouroboros-app`). */
  readonly actorService?: string;
  /** A plane (`policy.*`) or one action (`policy.published`). */
  readonly action?: string;
  /** A reference — `pr:509`, `run:<id>`, `repo:<ref>`, `key:<id>`, `subject:<id>`. */
  readonly ref?: string;
}

/** Where in the log a page starts, and how long it is. */
export interface AuditLogPaging {
  /** The previous page's `nextCursor`. Omitted for the first page. */
  readonly cursor?: string;
  /** Page size. The service defaults to 50 and refuses more than 200. */
  readonly limit?: number;
}

/** The audit log, as `ouroboros-rest` serves it. */
export const settingsAudit = {
  /**
   * The card's today view.
   *
   * @param client The client to call through. Defaults to the server-side one.
   * @returns Today's newest rows (UTC), whether there are more, and the retention tier.
   * @throws {ApiError} What the service answered — `403` for anybody below `admin`.
   */
  async today(client: ApiClient = api()): Promise<AuditToday> {
    return unwrap(await client.GET("/api/v1/settings/audit/today", {}));
  },

  /**
   * One page of the log, newest first.
   *
   * @param filter What to narrow by. An empty filter is the whole log.
   * @param paging The cursor to continue from, and the page size.
   * @param client The client to call through.
   * @returns The page. `nextCursor` is `null` on the last one.
   * @throws {ApiError} `422` for a filter or cursor the service does not accept; `403` for
   *   anybody below `admin`.
   */
  async list(
    filter: AuditLogFilter = {},
    paging: AuditLogPaging = {},
    client: ApiClient = api(),
  ): Promise<AuditLogPage> {
    return unwrap(
      await client.GET("/api/v1/settings/audit", {
        // Only the fields the caller set — see `app/api/audit.ts` on why.
        params: { query: { ...filter, ...paging } },
      }),
    );
  },
};
