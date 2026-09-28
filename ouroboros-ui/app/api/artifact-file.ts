import "server-only";

/**
 * One artifact's file, passed through to the browser
 * ([#341](https://github.com/NobuData/ouroboros/issues/341), over AT.5's
 * `GET /api/v1/artifacts/{id}`, [#333](https://github.com/NobuData/ouroboros/issues/333)).
 *
 * `app/api/run-transcript.ts` is the same file for a run's transcript, and the argument is the
 * same: a browser cannot reach `ouroboros-rest`, so this asks with the visitor's session cookies
 * and hands the body back **as a stream** — a rig capture is megabytes, and buffering it here
 * would hold it whole on a hop that only forwards it.
 *
 * **The bytes are the runner's, and here they are on the product's own origin.** So the two
 * headers that make serving them safe are *set* by this hop on every answer rather than trusted
 * to have arrived: `X-Content-Type-Options: nosniff` and
 * `Content-Security-Policy: sandbox; default-src 'none'`. A file that contains markup can neither
 * be sniffed into HTML nor run script with the visitor's session.
 *
 * **Nothing about where the file is kept travels back.** Only the file's type and its
 * disposition are passed on ({@link PASSED_HEADERS}); every other header the service or its
 * store answered stays here.
 *
 * A refusal passes through with the service's status and its envelope — `410 artifact_expired`
 * is what the inline viewer reads as *expired*. Nothing is cached anywhere: it is one
 * workspace's file.
 */

import { sessionCookieHeader } from "@/app/api/client";
import { CACHE_CONTROL } from "@/app/api/poll-response";
import { sessionCookies } from "@/app/api/server";
import { isArtifactId } from "@/app/api/test-results";
import { restUrl } from "@/app/env";

/** The code this hop answers, before calling out, for an id that is not a uuid. */
export const ARTIFACT_ID_INVALID_CODE = "validation_failed";

/** What is said beside {@link ARTIFACT_ID_INVALID_CODE}. */
export const ARTIFACT_ID_INVALID = "That is not an artifact id.";

/** The code a failed read is answered with when the service could not be reached. */
export const ARTIFACT_UNAVAILABLE_CODE = "artifact_unavailable";

/** What is said when the service could not be reached. */
export const UNREACHABLE_ARTIFACT = "The artifact could not be reached.";

/** How long to wait for the service's first byte, in milliseconds. The body is not timed. */
export const ARTIFACT_TIMEOUT_MS = 30_000;

/** The service's headers that travel back to the browser; everything else stays here. */
export const PASSED_HEADERS = ["Content-Type", "Content-Disposition"] as const;

/** The headers every answer carries, whatever the service sent. */
export const SAFETY_HEADERS: Readonly<Record<string, string>> = {
  "Cache-Control": CACHE_CONTROL,
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "sandbox; default-src 'none'",
};

/** The wiring tests replace. */
export interface ArtifactReadOptions {
  /** How to fetch. Defaults to the global. */
  readonly fetcher?: typeof fetch;
  /** Where the service is. Defaults to `OURO_REST_URL`. */
  readonly baseUrl?: string;
  /** The session cookie header. Defaults to this request's. */
  readonly cookie?: () => Promise<string | undefined>;
  /** How long to wait for the first byte. Defaults to {@link ARTIFACT_TIMEOUT_MS}. */
  readonly timeoutMs?: number;
}

/**
 * The service's path for one artifact's file.
 *
 * @param id The artifact's id, encoded here.
 * @returns `/api/v1/artifacts/{id}`.
 */
export function artifactPath(id: string): string {
  return `/api/v1/artifacts/${encodeURIComponent(id)}`;
}

/**
 * Fetch one artifact's file and answer the browser with it.
 *
 * @param id The artifact's id.
 * @param options The wiring tests replace.
 * @returns The streamed file with its type and disposition; the service's refusal with its
 *   status; a `422` for an id that is not a uuid, before anything is sent; or a `502` when the
 *   service could not be reached. Every answer carries {@link SAFETY_HEADERS}. Never a throw.
 */
export async function readArtifactFile(
  id: string,
  options: ArtifactReadOptions = {},
): Promise<Response> {
  if (!isArtifactId(id)) {
    return Response.json(
      { code: ARTIFACT_ID_INVALID_CODE, message: ARTIFACT_ID_INVALID },
      { status: 422, headers: SAFETY_HEADERS },
    );
  }

  const {
    fetcher = (input, init) => fetch(input, init),
    baseUrl = restUrl(),
    cookie = async () => sessionCookieHeader(await sessionCookies()),
    timeoutMs = ARTIFACT_TIMEOUT_MS,
  } = options;

  // The deadline is for the first byte: once the service has answered, a large file may take
  // as long as the reader's connection needs.
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), timeoutMs);

  let upstream: Response;
  try {
    const headers: Record<string, string> = {};
    const sent = await cookie();
    if (sent !== undefined) headers.Cookie = sent;

    upstream = await fetcher(`${baseUrl}${artifactPath(id)}`, {
      headers,
      cache: "no-store",
      signal: deadline.signal,
    });
  } catch {
    return Response.json(
      { code: ARTIFACT_UNAVAILABLE_CODE, message: UNREACHABLE_ARTIFACT },
      { status: 502, headers: SAFETY_HEADERS },
    );
  } finally {
    clearTimeout(timer);
  }

  const headers = new Headers();
  for (const name of PASSED_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  for (const [name, value] of Object.entries(SAFETY_HEADERS)) headers.set(name, value);

  return new Response(upstream.body, { status: upstream.status, headers });
}
