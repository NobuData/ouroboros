import "server-only";

/**
 * The dashboard aggregate, read **conditionally**
 * ([#87](https://github.com/NobuData/ouroboros/issues/87)).
 *
 * `GET /api/v1/dashboard` is the one payload behind mockup 02
 * ([#70](https://github.com/NobuData/ouroboros/issues/70)) and the one thing the poll asks
 * for: a strong `ETag`, `If-None-Match` on the way back, and a `304` with no body when
 * nothing in the workspace has moved (`docs/ARCHITECTURE.md` § 5.4). This module is the
 * server's half of that exchange; `app/api/dashboard/route.ts` is what puts it on this
 * origin, and `app/dashboard/summary-poll.ts` is the browser's half.
 *
 * ### Why this does not go through the typed client
 *
 * The same reason `app/api/health.ts` does not, in a different dress: **the response this
 * module exists for is not a `2xx`.** `app/api/client.ts`'s middleware turns every
 * non-`ok` response into a thrown `ApiError`, and a `304` is not `ok` — so a call through
 * the client would convert *nothing has changed*, which is the cheap answer the whole
 * contract is built around, into a rejection carrying an unreadable-envelope message about
 * a body that was correctly empty. Tolerating a `304` is not something the middleware can
 * be asked for per call, and adding an exception to it would put a hole in the property
 * every other call in this application depends on: *either the body the contract describes,
 * or a throw*.
 *
 * What the client would otherwise have contributed is kept rather than lost:
 *
 * - **The typing.** {@link SUMMARY_PATH} is typed as a path the contract publishes and
 *   {@link DashboardSummary} is the generated schema type, so `yarn api:sync` breaks this
 *   file rather than a browser.
 * - **The session.** The same two cookies, composed by the same function the client uses —
 *   `sessionCookieHeader` in `app/api/client.ts`, exported for exactly this caller.
 * - **The workspace.** Nothing is sent, because nothing should be: the request is scoped by
 *   `session."activeOrganizationId"` and an `X-Ouro-Tenant` this application does not mean
 *   to override with is `422 tenant_mismatch` waiting to happen (`app/api/server.ts`).
 *
 * ### What it does *not* do
 *
 * It does not redirect a `401` to the login screen, and that is deliberate. This read is
 * made on behalf of a poll, not of a render: the browser is already on a screen, and
 * throwing Next.js's redirect signal out of a route handler would answer the poll with a
 * `307` to a login page that the poll would then parse as a dashboard. The session ending
 * is an *answer* here — `{state: "gone"}` — and what the screen does about it is the
 * caller's, in the browser, where a person is.
 */

import { sessionCookieHeader } from "@/app/api/client";
import { ApiError } from "@/app/api/errors";
import type { paths } from "@/app/api/schema";
import { sessionCookies } from "@/app/api/server";
import {
  ETAG_HEADER,
  IF_NONE_MATCH_HEADER,
  type SummaryAnswer,
  UNREACHABLE_SUMMARY,
  UNREADABLE_SUMMARY,
  isDashboardSummary,
  readPollAfter,
} from "@/app/dashboard/summary";
import { restUrl } from "@/app/env";

/**
 * The aggregate's path on `ouroboros-rest`.
 *
 * Typed as a path the contract describes, so a rename in `openapi.yaml` is a failed
 * typecheck here after `yarn api:sync` rather than a `404` behind a pill that has quietly
 * stopped counting. The same technique `app/api/health.ts` uses, for the same reason.
 */
export const SUMMARY_PATH: keyof paths = "/api/v1/dashboard";

/**
 * How long to wait for the aggregate before giving up, in milliseconds.
 *
 * Comfortably inside the contract's fifteen-second cadence, so a service that has stopped
 * answering costs one slow poll rather than a queue of overlapping ones — the poll does not
 * start a second request while one is in flight, so a read that never resolved would stop
 * the loop altogether rather than merely slow it.
 */
export const SUMMARY_TIMEOUT_MS = 10_000;

/** What this module needs of a `fetch`. Narrower than the global, so a stub can satisfy it. */
export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

/** How to make one read. Everything is optional; tests are what supply any of it. */
export interface SummaryReadOptions {
  /** The tag the caller already holds, echoed as `If-None-Match`. `null` asks unconditionally. */
  etag?: string | null;
  /** How to make the request. Defaults to the runtime's `fetch`. */
  fetcher?: Fetcher;
  /** Base URL of `ouroboros-rest`. Defaults to the configured one. */
  baseUrl?: string;
}

/**
 * Read the dashboard aggregate on behalf of one poll.
 *
 * **This does not throw.** Every outcome it can meet is one of the contract's four answers,
 * because the caller is a route handler answering a poll and there is no error boundary
 * behind it that could render anything better than the poll itself can.
 *
 * @param options The tag to revalidate against, and the wiring tests replace.
 * @returns The answer — the payload, *unchanged*, *gone*, or a sentence about why not.
 */
export async function readDashboardSummary(
  options: SummaryReadOptions = {},
): Promise<SummaryAnswer> {
  const { etag = null, fetcher = (input, init) => fetch(input, init), baseUrl = restUrl() } =
    options;

  let response: Response;
  try {
    response = await fetcher(`${baseUrl}${SUMMARY_PATH}`, {
      headers: await requestHeaders(etag),
      // The browser's own cache is not in this exchange: the poll holds the tag and this
      // request is the revalidation. A cached answer here would be a pill reporting the
      // loop as it was when some earlier request asked.
      cache: "no-store",
      signal: AbortSignal.timeout(SUMMARY_TIMEOUT_MS),
    });
  } catch {
    // Whatever `fetch` rejected with — a `TypeError` for a dropped connection, a
    // `TimeoutError` for {@link SUMMARY_TIMEOUT_MS} — says the same thing to a reader
    // looking at a pill, and the distinction between them is one only a log can act on.
    return { state: "failed", reason: UNREACHABLE_SUMMARY, pollAfterSeconds: null };
  }

  return readAnswer(response);
}

/**
 * The headers one read is made with.
 *
 * @param etag The tag the caller holds, or `null` to ask unconditionally.
 * @returns The session cookies, and `If-None-Match` when there is a tag to revalidate.
 * @throws {Error} From `sessionCookieHeader`, for a cookie value that may not be forwarded.
 *   That is this application's own doing rather than the service's, and it is caught by
 *   {@link readDashboardSummary}'s caller as any other unexpected failure would be.
 */
async function requestHeaders(etag: string | null): Promise<Record<string, string>> {
  const headers: Record<string, string> = { Accept: "application/json" };

  const cookie = sessionCookieHeader(await sessionCookies());
  if (cookie !== undefined) headers.Cookie = cookie;

  // Sent verbatim, quotes and all: the tag travelled here from the service through this
  // application's own hands, and rewriting it is how a strong tag stops matching.
  if (etag !== null && etag !== "") headers[IF_NONE_MATCH_HEADER] = etag;

  return headers;
}

/**
 * Read one response as an answer.
 *
 * @param response What the service said.
 * @returns The answer, by status: `200` the payload, `304` unchanged, `401` gone, and
 *   anything else a sentence — the service's own where it sent one, because every message
 *   in the contract's envelope is written for a person and names nothing internal
 *   (`app/api/errors.ts`).
 */
async function readAnswer(response: Response): Promise<SummaryAnswer> {
  const etag = response.headers.get(ETAG_HEADER);
  const pollAfterSeconds = readPollAfter(response.headers);

  if (response.status === 304) {
    return { state: "unchanged", etag, pollAfterSeconds };
  }

  if (response.status === 401) {
    return { state: "gone" };
  }

  if (!response.ok) {
    const error = await ApiError.fromResponse(response);
    return { state: "failed", reason: error.message, pollAfterSeconds };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { state: "failed", reason: UNREADABLE_SUMMARY, pollAfterSeconds };
  }

  return isDashboardSummary(body)
    ? { state: "fresh", summary: body, etag, pollAfterSeconds }
    : { state: "failed", reason: UNREADABLE_SUMMARY, pollAfterSeconds };
}
