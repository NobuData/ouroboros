import "server-only";

/**
 * One investigation's progress stream, passed through to the browser (CN.2,
 * [#628](https://github.com/NobuData/ouroboros/issues/628), over CM.6's
 * `GET /api/v1/research/investigations/{id}/progress`,
 * [#625](https://github.com/NobuData/ouroboros/issues/625)).
 *
 * `app/api/artifact-file.ts` is the same hop for a file and the argument is the same: a browser
 * cannot reach `ouroboros-rest`, so this asks with the visitor's session cookies and hands the
 * body back **as a stream** — here one that stays open for as long as the run does, so
 * buffering it would mean never answering.
 *
 * **The browser's leaving closes the service's stream.** The request's own abort signal is
 * handed to the upstream fetch: when the `EventSource` is closed — the card is done, or the
 * reader navigated away — the service sees its subscriber go and stops polling for it.
 *
 * **Only the stream's own headers travel back.** The content type is set here, as the protocol
 * requires, with the two that keep a proxy from buffering it; every other header the service
 * answered stays here. A refusal — the investigation is another workspace's, or does not
 * exist — passes through with the service's status and envelope, so the card renders the
 * service's own sentence.
 */

import { sessionCookieHeader } from "@/app/api/client";
import { CACHE_CONTROL } from "@/app/api/poll-response";
import { sessionCookies } from "@/app/api/server";
import { restUrl } from "@/app/env";

/** The code this hop answers, before calling out, for an id that is not a uuid. */
export const INVESTIGATION_ID_INVALID_CODE = "validation_failed";

/** What is said beside {@link INVESTIGATION_ID_INVALID_CODE}. */
export const INVESTIGATION_ID_INVALID = "That is not an investigation id.";

/** The code a failed read is answered with when the service could not be reached. */
export const PROGRESS_UNAVAILABLE_CODE = "investigation_progress_unavailable";

/** What is said when the service could not be reached. */
export const UNREACHABLE_PROGRESS = "The investigation's progress could not be reached.";

/** How long to wait for the service's first byte, in milliseconds. The stream is not timed. */
export const PROGRESS_TIMEOUT_MS = 30_000;

/** The stream's media type, as the service and the browser both spell it. */
export const SSE_MEDIA_TYPE = "text/event-stream";

/** The headers a streamed answer carries — the protocol's, and the two that stop buffering. */
export const STREAM_HEADERS: Readonly<Record<string, string>> = {
  "Content-Type": `${SSE_MEDIA_TYPE}; charset=utf-8`,
  "Cache-Control": "no-cache, no-transform",
  "X-Accel-Buffering": "no",
  "X-Content-Type-Options": "nosniff",
};

/** A uuid, in either case. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether a value is an investigation id.
 *
 * @param value Anything.
 * @returns True for a uuid string and nothing else.
 */
export function isInvestigationId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/**
 * The service's path for one investigation's stream.
 *
 * @param id The investigation's id, encoded here.
 * @returns `/api/v1/research/investigations/{id}/progress`.
 */
export function progressPath(id: string): string {
  return `/api/v1/research/investigations/${encodeURIComponent(id)}/progress`;
}

/** The wiring tests replace. */
export interface ProgressReadOptions {
  /** How to fetch. Defaults to the global. */
  readonly fetcher?: typeof fetch;
  /** Where the service is. Defaults to `OURO_REST_URL`. */
  readonly baseUrl?: string;
  /** The session cookie header. Defaults to this request's. */
  readonly cookie?: () => Promise<string | undefined>;
  /** How long to wait for the first byte. Defaults to {@link PROGRESS_TIMEOUT_MS}. */
  readonly timeoutMs?: number;
  /** The browser's own leaving, which ends the service's stream too. */
  readonly signal?: AbortSignal;
}

/**
 * Open one investigation's stream and answer the browser with it.
 *
 * @param id The investigation's id.
 * @param options The wiring tests replace.
 * @returns The stream, under {@link STREAM_HEADERS}; the service's refusal with its status; a
 *   `422` for an id that is not a uuid, before anything is sent; or a `502` when the service
 *   could not be reached. Never a throw.
 */
export async function readInvestigationProgress(
  id: string,
  options: ProgressReadOptions = {},
): Promise<Response> {
  if (!isInvestigationId(id)) {
    return Response.json(
      { code: INVESTIGATION_ID_INVALID_CODE, message: INVESTIGATION_ID_INVALID },
      { status: 422, headers: { "Cache-Control": CACHE_CONTROL } },
    );
  }

  const {
    fetcher = (input, init) => fetch(input, init),
    baseUrl = restUrl(),
    cookie = async () => sessionCookieHeader(await sessionCookies()),
    timeoutMs = PROGRESS_TIMEOUT_MS,
    signal,
  } = options;

  // The deadline is for the first byte; the stream itself lives as long as the run and the
  // reader do. The browser's leaving, handed in as `signal`, ends it too.
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), timeoutMs);
  const onLeave = (): void => deadline.abort();
  signal?.addEventListener("abort", onLeave, { once: true });

  let upstream: Response;
  try {
    const headers: Record<string, string> = { Accept: SSE_MEDIA_TYPE };
    const sent = await cookie();
    if (sent !== undefined) headers.Cookie = sent;

    upstream = await fetcher(`${baseUrl}${progressPath(id)}`, {
      headers,
      cache: "no-store",
      signal: deadline.signal,
    });
  } catch {
    signal?.removeEventListener("abort", onLeave);
    return Response.json(
      { code: PROGRESS_UNAVAILABLE_CODE, message: UNREACHABLE_PROGRESS },
      { status: 502, headers: { "Cache-Control": CACHE_CONTROL } },
    );
  } finally {
    clearTimeout(timer);
  }

  if (!upstream.ok) {
    signal?.removeEventListener("abort", onLeave);
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
        "Cache-Control": CACHE_CONTROL,
      },
    });
  }

  return new Response(upstream.body, { status: 200, headers: STREAM_HEADERS });
}
