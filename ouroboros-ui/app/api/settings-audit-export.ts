import "server-only";

/**
 * The audit log's CSV export, passed through to the browser as a stream
 * (BS.5, [#495](https://github.com/NobuData/ouroboros/issues/495), over BR.2's
 * `GET /api/v1/settings/audit/export.csv`, [#486](https://github.com/NobuData/ouroboros/issues/486)).
 *
 * A browser cannot reach `ouroboros-rest`, so this asks with the visitor's session cookies and
 * hands the body back **as a stream**: the service writes the file a batch at a time so that a
 * year of history is never held whole on either side, and buffering it here would undo that. The
 * shape is `app/api/run-transcript.ts`'s.
 *
 * ### Only the export's own parameters travel
 *
 * The query is rebuilt from {@link EXPORT_PARAMETERS} rather than forwarded, so nothing else a
 * link might carry reaches the service. `from` and `to` are required here as they are there — a
 * request without both is refused before anything is sent, because *download everything* is the
 * request this export exists to make impossible. The bound itself (at most 366 days) is the
 * service's to enforce; `app/audit-log/view.ts` checks it in the dialog first so a person is told
 * in a sentence rather than by a failed download.
 *
 * A refusal passes through with the service's status and envelope. Nothing is cached.
 */

import { sessionCookieHeader } from "@/app/api/client";
import { CACHE_CONTROL } from "@/app/api/poll-response";
import { sessionCookies } from "@/app/api/server";
import { restUrl } from "@/app/env";

/** The service's path for the export. */
export const AUDIT_EXPORT_PATH = "/api/v1/settings/audit/export.csv";

/** The query parameters the export takes — the range, then the log's filters. */
export const EXPORT_PARAMETERS = [
  "from",
  "to",
  "actorKind",
  "actorId",
  "actorService",
  "action",
  "ref",
] as const;

/** The code a request without a range is answered with. */
export const EXPORT_RANGE_REQUIRED_CODE = "audit_export_range_required";

/** What a request without a range is told. */
export const EXPORT_RANGE_REQUIRED = "An audit export needs a from and a to.";

/** The code a failed export is answered with when the service could not be reached. */
export const EXPORT_UNAVAILABLE_CODE = "audit_export_unavailable";

/** What is said when the service could not be reached. */
export const EXPORT_UNREACHABLE = "The audit export could not be reached.";

/** How long to wait for the service's first byte, in milliseconds. */
export const EXPORT_TIMEOUT_MS = 30_000;

/** The service's headers that travel back to the browser; everything else stays here. */
export const PASSED_HEADERS = ["Content-Type", "Content-Disposition", "X-Ouro-Export-Rows"] as const;

/** The wiring tests replace. */
export interface AuditExportOptions {
  /** How to fetch. Defaults to the global. */
  readonly fetcher?: typeof fetch;
  /** Where the service is. Defaults to `OURO_REST_URL`. */
  readonly baseUrl?: string;
  /** The session cookie header. Defaults to this request's. */
  readonly cookie?: () => Promise<string | undefined>;
}

/**
 * The export's query, rebuilt from what a request carried.
 *
 * @param query The request's own query.
 * @returns Only {@link EXPORT_PARAMETERS}, each at most once, empty values left out.
 */
export function exportQuery(query: URLSearchParams): URLSearchParams {
  const sent = new URLSearchParams();

  for (const name of EXPORT_PARAMETERS) {
    const value = query.get(name);
    if (value !== null && value !== "") sent.set(name, value);
  }

  return sent;
}

/**
 * Fetch one export and answer the browser with it.
 *
 * @param query The request's query — the range and the filters.
 * @param options The wiring tests replace.
 * @returns The streamed file with its type, disposition and row count; the service's refusal
 *   with its status; a `422` for a request without a range, before anything is sent; or a `502`
 *   when the service could not be reached. Never a throw.
 */
export async function readAuditExport(
  query: URLSearchParams,
  options: AuditExportOptions = {},
): Promise<Response> {
  const sentQuery = exportQuery(query);

  if (!sentQuery.has("from") || !sentQuery.has("to")) {
    return Response.json(
      { code: EXPORT_RANGE_REQUIRED_CODE, message: EXPORT_RANGE_REQUIRED },
      { status: 422, headers: { "Cache-Control": CACHE_CONTROL } },
    );
  }

  const {
    fetcher = (input, init) => fetch(input, init),
    baseUrl = restUrl(),
    cookie = async () => sessionCookieHeader(await sessionCookies()),
  } = options;

  let upstream: Response;
  try {
    const headers: Record<string, string> = {};
    const sent = await cookie();
    if (sent !== undefined) headers.Cookie = sent;

    upstream = await fetcher(`${baseUrl}${AUDIT_EXPORT_PATH}?${sentQuery.toString()}`, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(EXPORT_TIMEOUT_MS),
    });
  } catch {
    return Response.json(
      { code: EXPORT_UNAVAILABLE_CODE, message: EXPORT_UNREACHABLE },
      { status: 502, headers: { "Cache-Control": CACHE_CONTROL } },
    );
  }

  const headers = new Headers({ "Cache-Control": CACHE_CONTROL });
  for (const name of PASSED_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) headers.set(name, value);
  }

  return new Response(upstream.body, { status: upstream.status, headers });
}
