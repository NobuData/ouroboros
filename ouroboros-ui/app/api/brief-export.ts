import "server-only";

/**
 * A brief's Markdown export, passed through to the browser (CN.4,
 * [#630](https://github.com/NobuData/ouroboros/issues/630), over CM.2's
 * `GET /api/v1/research/investigations/{id}/brief/export`,
 * [#621](https://github.com/NobuData/ouroboros/issues/621)).
 *
 * `app/api/artifact-file.ts` is the same hop for a runner's file and the argument is the same: a
 * browser cannot reach `ouroboros-rest`, so this asks with the visitor's session cookies and
 * hands the body back as it came — here a small Markdown file, with the service's own
 * `Content-Disposition` so the browser saves it under the brief's name (`RS-127-brief.md`).
 *
 * **The bytes are a brief the service rendered, and here they are on the product's own
 * origin.** So the two headers that make serving a file safe are set by this hop on every answer
 * rather than trusted to have arrived: `X-Content-Type-Options: nosniff` and
 * `Content-Security-Policy: sandbox; default-src 'none'`. A refusal — no brief yet, another
 * workspace's investigation — passes through with the service's status and envelope.
 */

import { sessionCookieHeader } from "@/app/api/client";
import { CACHE_CONTROL } from "@/app/api/poll-response";
import { isInvestigationId } from "@/app/api/research-progress";
import { sessionCookies } from "@/app/api/server";
import { restUrl } from "@/app/env";
import { briefExportUrl } from "@/app/research/brief";

/** The code this hop answers, before calling out, for an id that is not a uuid. */
export const BRIEF_ID_INVALID_CODE = "validation_failed";

/** What is said beside {@link BRIEF_ID_INVALID_CODE}. */
export const BRIEF_ID_INVALID = "That is not an investigation id.";

/** The code a failed read is answered with when the service could not be reached. */
export const BRIEF_EXPORT_UNAVAILABLE_CODE = "brief_export_unavailable";

/** What is said when the service could not be reached. */
export const UNREACHABLE_BRIEF_EXPORT = "The brief could not be exported.";

/** How long to wait for the service's answer, in milliseconds. */
export const BRIEF_EXPORT_TIMEOUT_MS = 30_000;

/** The service's headers that travel back to the browser; everything else stays here. */
export const PASSED_HEADERS = ["Content-Type", "Content-Disposition"] as const;

/** The headers every answer carries, whatever the service sent. */
export const SAFETY_HEADERS: Readonly<Record<string, string>> = {
  "Cache-Control": CACHE_CONTROL,
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "sandbox; default-src 'none'",
};

/**
 * The service's path for one brief's export.
 *
 * @param id The investigation's id, encoded here.
 * @returns `/api/v1/research/investigations/{id}/brief/export`.
 */
export function briefExportPath(id: string): string {
  return `/api/v1/research/investigations/${encodeURIComponent(id)}/brief/export`;
}

export { briefExportUrl };

/** The wiring tests replace. */
export interface BriefExportOptions {
  /** How to fetch. Defaults to the global. */
  readonly fetcher?: typeof fetch;
  /** Where the service is. Defaults to `OURO_REST_URL`. */
  readonly baseUrl?: string;
  /** The session cookie header. Defaults to this request's. */
  readonly cookie?: () => Promise<string | undefined>;
  /** How long to wait. Defaults to {@link BRIEF_EXPORT_TIMEOUT_MS}. */
  readonly timeoutMs?: number;
}

/**
 * Fetch one brief's export and answer the browser with it.
 *
 * @param id The investigation's id.
 * @param options The wiring tests replace.
 * @returns The file with its type and disposition; the service's refusal with its status; a
 *   `422` for an id that is not a uuid, before anything is sent; or a `502` when the service
 *   could not be reached. Every answer carries {@link SAFETY_HEADERS}. Never a throw.
 */
export async function readBriefExport(
  id: string,
  options: BriefExportOptions = {},
): Promise<Response> {
  if (!isInvestigationId(id)) {
    return Response.json(
      { code: BRIEF_ID_INVALID_CODE, message: BRIEF_ID_INVALID },
      { status: 422, headers: SAFETY_HEADERS },
    );
  }

  const {
    fetcher = (input, init) => fetch(input, init),
    baseUrl = restUrl(),
    cookie = async () => sessionCookieHeader(await sessionCookies()),
    timeoutMs = BRIEF_EXPORT_TIMEOUT_MS,
  } = options;

  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), timeoutMs);

  let upstream: Response;
  try {
    const headers: Record<string, string> = {};
    const sent = await cookie();
    if (sent !== undefined) headers.Cookie = sent;

    upstream = await fetcher(`${baseUrl}${briefExportPath(id)}`, {
      headers,
      cache: "no-store",
      signal: deadline.signal,
    });
  } catch {
    return Response.json(
      { code: BRIEF_EXPORT_UNAVAILABLE_CODE, message: UNREACHABLE_BRIEF_EXPORT },
      { status: 502, headers: SAFETY_HEADERS },
    );
  } finally {
    clearTimeout(timer);
  }

  const headers = new Headers(SAFETY_HEADERS);
  for (const name of PASSED_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  if (!upstream.ok) headers.set("Content-Type", upstream.headers.get("Content-Type") ?? "application/json");

  return new Response(upstream.body, { status: upstream.status, headers });
}
