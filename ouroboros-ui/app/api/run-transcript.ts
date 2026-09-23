import "server-only";

/**
 * A run's transcript as JSONL, passed through to the browser
 * ([#310](https://github.com/NobuData/ouroboros/issues/310)).
 *
 * The take-over dialog links to the raw transcript (AP.2's `GET /api/v1/runs/{id}/transcript.jsonl`,
 * [#304](https://github.com/NobuData/ouroboros/issues/304)), and a browser cannot reach
 * `ouroboros-rest` itself. So this asks with the visitor's session cookies and hands the body
 * back **as a stream** — the service writes the file a batch at a time so that neither side
 * holds a long transcript whole, and buffering it here would undo that.
 *
 * The typed client is not used because its middleware parses bodies; a raw `fetch` is the
 * shape `app/api/dashboard-summary.ts` already keeps for the same reason.
 *
 * A refusal passes through with the service's status and its envelope — a download opened in
 * a new tab has nobody to redirect, and *No such run* is the most useful thing that tab can
 * show. Nothing is cached anywhere: it is one workspace's transcript.
 */

import { sessionCookieHeader } from "@/app/api/client";
import { RUN_ID_INVALID, RUN_ID_INVALID_CODE, isRunId } from "@/app/api/runs";
import { CACHE_CONTROL } from "@/app/api/poll-response";
import { sessionCookies } from "@/app/api/server";
import { restUrl } from "@/app/env";

/** The code a failed read is answered with when the service could not be reached. */
export const RUN_TRANSCRIPT_UNAVAILABLE_CODE = "run_transcript_unavailable";

/** What is said when the service could not be reached. */
export const UNREACHABLE_TRANSCRIPT = "The transcript could not be reached.";

/** How long to wait for the service's first byte, in milliseconds. */
export const TRANSCRIPT_TIMEOUT_MS = 30_000;

/** The service's headers that travel back to the browser; everything else stays here. */
export const PASSED_HEADERS = ["Content-Type", "Content-Disposition"] as const;

/** The wiring tests replace. */
export interface TranscriptReadOptions {
  /** How to fetch. Defaults to the global. */
  readonly fetcher?: typeof fetch;
  /** Where the service is. Defaults to `OURO_REST_URL`. */
  readonly baseUrl?: string;
  /** The session cookie header. Defaults to this request's. */
  readonly cookie?: () => Promise<string | undefined>;
}

/**
 * The service's path for one run's transcript.
 *
 * @param id The run's id, encoded here.
 * @returns `/api/v1/runs/{id}/transcript.jsonl`.
 */
export function transcriptPath(id: string): string {
  return `/api/v1/runs/${encodeURIComponent(id)}/transcript.jsonl`;
}

/**
 * Fetch one run's transcript and answer the browser with it.
 *
 * @param id The run's id.
 * @param options The wiring tests replace.
 * @returns The streamed file with its type and disposition; the service's refusal with its
 *   status; a `422` for an id that is not a uuid, before anything is sent; or a `502` when the
 *   service could not be reached. Never a throw.
 */
export async function readRunTranscript(
  id: string,
  options: TranscriptReadOptions = {},
): Promise<Response> {
  if (!isRunId(id)) {
    return Response.json(
      { code: RUN_ID_INVALID_CODE, message: RUN_ID_INVALID },
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

    upstream = await fetcher(`${baseUrl}${transcriptPath(id)}`, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(TRANSCRIPT_TIMEOUT_MS),
    });
  } catch {
    return Response.json(
      { code: RUN_TRANSCRIPT_UNAVAILABLE_CODE, message: UNREACHABLE_TRANSCRIPT },
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
