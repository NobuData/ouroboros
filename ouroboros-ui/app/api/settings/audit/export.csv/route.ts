/**
 * `GET /api/settings/audit/export.csv` — the audit log's CSV export, on this origin
 * (BS.5, [#495](https://github.com/NobuData/ouroboros/issues/495)).
 *
 * The Audit card's **Export CSV** dialog downloads from here. The browser cannot reach
 * `ouroboros-rest`, so this streams the service's export back over the visitor's session
 * (`app/api/settings-audit-export.ts`). The role gate — owners and admins — and the bounded
 * range are the service's.
 */

import { readAuditExport } from "@/app/api/settings-audit-export";

/**
 * Answer one download.
 *
 * @param request The request — its query carries the range and the filters.
 * @returns The file, streamed, or the refusal.
 */
export async function GET(request: Request): Promise<Response> {
  return readAuditExport(new URL(request.url).searchParams);
}
