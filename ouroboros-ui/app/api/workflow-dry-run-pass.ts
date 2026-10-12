import "server-only";

/**
 * The dry-run card's reads and writes, passed through to the browser (CE.4,
 * [#568](https://github.com/NobuData/ouroboros/issues/568)) — over CD.4's and CD.5's routes under
 * `/api/v1/workflows/{id}/dry-runs` ([#562](https://github.com/NobuData/ouroboros/issues/562),
 * [#563](https://github.com/NobuData/ouroboros/issues/563)).
 *
 * `app/api/workflow-copilot-stream.ts` is the same hop for the conversation and the argument is
 * the same: a browser cannot reach `ouroboros-rest`, so this asks with the visitor's session
 * cookies and hands the answer back — a run's events **as a stream**, for as long as the run
 * takes, and everything else as the service's own status and JSON.
 *
 * ### One hop, three kinds of answer
 *
 * - a **read** (`GET`): the run, its suggestions, an explanation, the picker's candidates;
 * - a **stream** (`GET …/events`): server-sent events, which the card's `EventSource` consumes;
 * - a **write** (`POST`): start, cancel, re-run, apply, ignore.
 *
 * All three are held to the conversation's rule: a request another site made is refused before
 * anything is forwarded ({@link sameOrigin}), and every id the path carries must be a uuid before
 * a request is made of it. No workspace travels — the service resolves it from the session.
 *
 * **A refusal is passed through as it is.** `409 dry_run_in_progress`, `422
 * dry_run_repository_unresolved`, `409 dry_run_suggestion_conflict`: the card shows the service's
 * sentence, so the status and the envelope reach it untouched.
 *
 * **The browser's leaving closes the service's stream.** The request's abort signal is handed to
 * the upstream fetch.
 */

import { sessionCookieHeader } from "@/app/api/client";
import { CACHE_CONTROL } from "@/app/api/poll-response";
import { SSE_MEDIA_TYPE, STREAM_HEADERS } from "@/app/api/research-progress";
import { sessionCookies } from "@/app/api/server";
import {
  COPILOT_REQUEST_INVALID_CODE,
  CROSS_ORIGIN,
  CROSS_ORIGIN_CODE,
  MAX_BODY_BYTES,
  isCopilotId,
  sameOrigin,
} from "@/app/api/workflow-copilot-stream";
import { restUrl } from "@/app/env";

/** What is said for an id that is not a uuid. */
export const DRY_RUN_ID_INVALID = "That is not a dry run this page can address.";

/** What is said for a body over the forwarded bound. */
export const DRY_RUN_BODY_TOO_LARGE = "That request is too large to send.";

/** The code an answer carries when the service could not be reached. */
export const DRY_RUN_UNAVAILABLE_CODE = "dry_run_unavailable";

/** What is said when the service could not be reached. */
export const UNREACHABLE_DRY_RUN = "The dry-run service could not be reached. Nothing was changed.";

/** How long to wait for the service's first byte, in milliseconds. A stream is not timed. */
export const DRY_RUN_TIMEOUT_MS = 30_000;

/** How many candidates the picker asks for. */
export const CANDIDATE_LIMIT = 8;

/**
 * The service's path for a workflow's dry runs — the history, and where one is started.
 *
 * @param workflowId The workflow.
 * @returns `/api/v1/workflows/{id}/dry-runs`.
 */
export function dryRunsPath(workflowId: string): string {
  return `/api/v1/workflows/${encodeURIComponent(workflowId)}/dry-runs`;
}

/**
 * The service's path for the picker's ranked candidates.
 *
 * @param workflowId The workflow.
 * @returns `…/dry-runs/candidates?limit=8`.
 */
export function candidatesPath(workflowId: string): string {
  return `${dryRunsPath(workflowId)}/candidates?limit=${CANDIDATE_LIMIT}`;
}

/**
 * The service's path for one dry run, or for something under it.
 *
 * @param workflowId The workflow.
 * @param dryRunId The dry run.
 * @param rest What follows it — `events`, `cancel`, `rerun`, `suggestions`. Omitted, the run itself.
 * @returns `…/dry-runs/{dryRunId}` or `…/dry-runs/{dryRunId}/{rest}`.
 */
export function dryRunPath(
  workflowId: string,
  dryRunId: string,
  rest?: "events" | "cancel" | "rerun" | "suggestions",
): string {
  const run = `${dryRunsPath(workflowId)}/${encodeURIComponent(dryRunId)}`;

  return rest === undefined ? run : `${run}/${rest}`;
}

/**
 * The service's path for one suggestion's explanation, or for settling it.
 *
 * @param workflowId The workflow.
 * @param dryRunId The dry run.
 * @param suggestionId The suggestion.
 * @param rest `explanation`, `apply` or `ignore`.
 * @returns `…/suggestions/{suggestionId}/{rest}`.
 */
export function suggestionPath(
  workflowId: string,
  dryRunId: string,
  suggestionId: string,
  rest: "explanation" | "apply" | "ignore",
): string {
  return `${dryRunPath(workflowId, dryRunId, "suggestions")}/${encodeURIComponent(suggestionId)}/${rest}`;
}

/** The wiring tests replace. */
export interface DryRunPassOptions {
  /** How to fetch. Defaults to the global. */
  readonly fetcher?: typeof fetch;
  /** Where the service is. Defaults to `OURO_REST_URL`. */
  readonly baseUrl?: string;
  /** The session cookie header. Defaults to this request's. */
  readonly cookie?: () => Promise<string | undefined>;
  /** How long to wait for the first byte. Defaults to {@link DRY_RUN_TIMEOUT_MS}. */
  readonly timeoutMs?: number;
}

/**
 * A refusal this hop makes itself, in the service's envelope.
 *
 * @param status The status.
 * @param code The code.
 * @param message The sentence.
 * @returns The response.
 */
function refuse(status: number, code: string, message: string): Response {
  return Response.json({ code, message, details: {} }, { status, headers: { "Cache-Control": CACHE_CONTROL } });
}

/**
 * Pass one of the card's requests through to the service and answer the browser with what it
 * says. The method is the request's own: a `GET` forwards no body, a `POST` forwards the body as
 * the browser sent it, bounded.
 *
 * @param request The browser's request — its abort signal is the browser's leaving.
 * @param ids Every id the path carries; each must be a uuid.
 * @param path The service's path, built from those ids.
 * @param options The wiring tests replace.
 * @returns A run's events under the stream's headers; the service's JSON answer or refusal with
 *   its status; a `403` for another site's request, a `422` for an id that is not a uuid and a
 *   `413` for an oversized body, each before anything is sent; or a `502` when the service could
 *   not be reached. Never a throw.
 */
export async function passDryRun(
  request: Request,
  ids: readonly string[],
  path: string,
  options: DryRunPassOptions = {},
): Promise<Response> {
  if (!sameOrigin(request.headers)) return refuse(403, CROSS_ORIGIN_CODE, CROSS_ORIGIN);
  if (!ids.every(isCopilotId)) return refuse(422, COPILOT_REQUEST_INVALID_CODE, DRY_RUN_ID_INVALID);

  const writes = request.method === "POST";
  const body = writes ? await request.text() : "";
  if (new TextEncoder().encode(body).length > MAX_BODY_BYTES) {
    return refuse(413, COPILOT_REQUEST_INVALID_CODE, DRY_RUN_BODY_TOO_LARGE);
  }

  const {
    fetcher = (input, init) => fetch(input, init),
    baseUrl = restUrl(),
    cookie = async () => sessionCookieHeader(await sessionCookies()),
    timeoutMs = DRY_RUN_TIMEOUT_MS,
  } = options;

  // The deadline is for the first byte; a stream lives as long as the run and the reader do.
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), timeoutMs);
  const onLeave = (): void => deadline.abort();
  request.signal.addEventListener("abort", onLeave, { once: true });

  let upstream: Response;
  try {
    const headers: Record<string, string> = { Accept: `${SSE_MEDIA_TYPE}, application/json` };
    if (body !== "") headers["Content-Type"] = "application/json";
    const sent = await cookie();
    if (sent !== undefined) headers.Cookie = sent;

    upstream = await fetcher(`${baseUrl}${path}`, {
      method: writes ? "POST" : "GET",
      headers,
      body: body === "" ? undefined : body,
      cache: "no-store",
      signal: deadline.signal,
    });
  } catch {
    request.signal.removeEventListener("abort", onLeave);
    return refuse(502, DRY_RUN_UNAVAILABLE_CODE, UNREACHABLE_DRY_RUN);
  } finally {
    clearTimeout(timer);
  }

  const type = upstream.headers.get("Content-Type") ?? "application/json";
  if (upstream.ok && type.startsWith(SSE_MEDIA_TYPE)) {
    return new Response(upstream.body, { status: 200, headers: STREAM_HEADERS });
  }

  // A JSON answer — a run, a list, a refusal — ends here: nothing is left to abort.
  request.signal.removeEventListener("abort", onLeave);
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "Content-Type": type, "Cache-Control": CACHE_CONTROL },
  });
}
