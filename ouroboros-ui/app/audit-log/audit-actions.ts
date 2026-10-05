"use server";

/**
 * The server hop for the Audit card's filtered log
 * (BS.5, [#495](https://github.com/NobuData/ouroboros/issues/495)).
 *
 * The browser cannot reach `ouroboros-rest`, so the card's filters call this and this calls
 * `GET /api/v1/settings/audit`. The workspace is the session's and **the role gate is the
 * service's** — owners and admins; a Server Action is a POST anybody can reach, and a reader
 * below admin who calls it gets the service's `403` back as a sentence and reads nothing.
 *
 * A refusal is a value, not a throw: the log is one region of a page the reader is still entitled
 * to be on. Every value this module needs is imported, because a `"use server"` module may export
 * nothing but async functions.
 */

import { isApiError } from "@/app/api/errors";
import { type AuditLogFilter, settingsAudit } from "@/app/api/settings-audit";

import { AUDIT_FORBIDDEN, AUDIT_PAGE_SIZE, AUDIT_UNAVAILABLE, type AuditLogReading } from "./view";

/** The `code` the contract answers a reader below admin with. */
const FORBIDDEN = "forbidden";

/**
 * Read one page of the caller's workspace's audit log, newest first.
 *
 * @param filter What to narrow by — `app/audit-log/view.ts`'s `parseFilterForm` builds it.
 * @param cursor The previous page's `nextCursor`. Omitted for the first page.
 * @returns The page, or the sentence to show instead.
 * @throws Whatever is not an `ApiError` — a redirect to sign in keeps travelling.
 */
export async function readAuditLog(
  filter: AuditLogFilter,
  cursor?: string,
): Promise<AuditLogReading> {
  try {
    const page = await settingsAudit.list(
      filter,
      cursor === undefined ? { limit: AUDIT_PAGE_SIZE } : { cursor, limit: AUDIT_PAGE_SIZE },
    );

    return { ok: true, page };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return {
      ok: false,
      reason: error.code === FORBIDDEN ? AUDIT_FORBIDDEN : error.message || AUDIT_UNAVAILABLE,
    };
  }
}
