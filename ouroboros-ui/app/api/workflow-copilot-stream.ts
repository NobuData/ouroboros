import "server-only";

/**
 * The copilot conversation's three writes, passed through to the browser (CE.2,
 * [#566](https://github.com/NobuData/ouroboros/issues/566)) — over CD.1's
 * `POST /api/v1/workflows/{id}/copilot/sessions`, `…/sessions/{sessionId}/messages` and
 * `…/messages/{messageId}/answers` ([#559](https://github.com/NobuData/ouroboros/issues/559)).
 *
 * `app/api/research-progress.ts` is the same hop for a `GET` and the argument is the same: a
 * browser cannot reach `ouroboros-rest`, so this asks with the visitor's session cookies and hands
 * the body back **as a stream**. A reply arrives as server-sent events for as long as the model
 * takes; buffering it would turn *watch it build* into *wait, then read*.
 *
 * ### These are writes, so the caller is checked first
 *
 * A Server Action is origin-checked by the framework; a Route Handler is not. {@link sameOrigin}
 * refuses a `POST` whose `Origin` names another host, or that the browser itself marks as
 * cross-site, before anything is forwarded — the session cookie is `SameSite=Lax`, and this is
 * the second lock rather than the only one.
 *
 * ### What travels, in each direction
 *
 * - **In:** the path's ids, checked to be uuids before a request is made of them; the body as
 *   the browser sent it, bounded; the session cookies. No workspace — the service resolves it
 *   from the session, as everywhere under `/api/v1/workflows`.
 * - **Out:** a stream under {@link STREAM_HEADERS}, or — for the session start, and for every
 *   refusal — the service's own status and JSON envelope, so the card says the service's
 *   sentence. Every other header the service answered stays here.
 *
 * **The browser's leaving closes the service's stream.** The request's abort signal is handed to
 * the upstream fetch. The service keeps what the reply had already applied and records the reply
 * as interrupted; the next read of the conversation shows it so.
 */

import { sessionCookieHeader } from "@/app/api/client";
import { CACHE_CONTROL } from "@/app/api/poll-response";
import { SSE_MEDIA_TYPE, STREAM_HEADERS } from "@/app/api/research-progress";
import { sessionCookies } from "@/app/api/server";
import { restUrl } from "@/app/env";

export { SSE_MEDIA_TYPE, STREAM_HEADERS };

/** The code this hop answers for a `POST` that did not come from this origin. */
export const CROSS_ORIGIN_CODE = "forbidden";

/** What is said beside {@link CROSS_ORIGIN_CODE}. */
export const CROSS_ORIGIN = "This request did not come from this site.";

/** The code this hop answers, before calling out, for an id that is not a uuid or a body too large. */
export const COPILOT_REQUEST_INVALID_CODE = "validation_failed";

/** What is said for an id that is not a uuid. */
export const COPILOT_ID_INVALID = "That is not a conversation this page can address.";

/** What is said for a body over {@link MAX_BODY_BYTES}. */
export const COPILOT_BODY_TOO_LARGE = "That message is too long to send.";

/** The code a write is answered with when the service could not be reached. */
export const COPILOT_UNAVAILABLE_CODE = "copilot_unavailable";

/** What is said when the service could not be reached. */
export const UNREACHABLE_COPILOT = "The copilot could not be reached. Nothing was sent.";

/** How long to wait for the service's first byte, in milliseconds. The stream is not timed. */
export const COPILOT_TIMEOUT_MS = 30_000;

/** The largest body forwarded, in bytes — far above any message a person types. */
export const MAX_BODY_BYTES = 64 * 1024;

/** A uuid, in either case. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether a value is an id these paths may carry.
 *
 * @param value Anything.
 * @returns True for a uuid string and nothing else.
 */
export function isCopilotId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/**
 * The service's path for starting a workflow's conversation.
 *
 * @param workflowId The workflow.
 * @returns `/api/v1/workflows/{id}/copilot/sessions`.
 */
export function sessionsPath(workflowId: string): string {
  return `/api/v1/workflows/${encodeURIComponent(workflowId)}/copilot/sessions`;
}

/**
 * The service's path for sending a message.
 *
 * @param workflowId The workflow.
 * @param sessionId The conversation.
 * @returns `…/copilot/sessions/{sessionId}/messages`.
 */
export function messagesPath(workflowId: string, sessionId: string): string {
  return `${sessionsPath(workflowId)}/${encodeURIComponent(sessionId)}/messages`;
}

/**
 * The service's path for answering one of a reply's questions.
 *
 * @param workflowId The workflow.
 * @param sessionId The conversation.
 * @param messageId The reply that asked.
 * @returns `…/messages/{messageId}/answers`.
 */
export function answersPath(workflowId: string, sessionId: string, messageId: string): string {
  return `${messagesPath(workflowId, sessionId)}/${encodeURIComponent(messageId)}/answers`;
}

/**
 * Whether a request came from this site.
 *
 * The rule the framework applies to Server Actions: an `Origin`, when the browser sent one, must
 * name the host the request was addressed to (`X-Forwarded-Host` behind a proxy, else `Host`);
 * and a browser that classifies the request itself (`Sec-Fetch-Site`) must have called it
 * `same-origin`. A request carrying neither header is not a browser's cross-site form post — it
 * is a script with its own cookies — and passes.
 *
 * @param headers The request's headers.
 * @returns False for a request another site made.
 */
export function sameOrigin(headers: Headers): boolean {
  const site = headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") return false;

  const origin = headers.get("origin");
  if (origin === null) return true;

  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  try {
    return host !== null && new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** The wiring tests replace. */
export interface CopilotPassOptions {
  /** How to fetch. Defaults to the global. */
  readonly fetcher?: typeof fetch;
  /** Where the service is. Defaults to `OURO_REST_URL`. */
  readonly baseUrl?: string;
  /** The session cookie header. Defaults to this request's. */
  readonly cookie?: () => Promise<string | undefined>;
  /** How long to wait for the first byte. Defaults to {@link COPILOT_TIMEOUT_MS}. */
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
 * Pass one of the conversation's writes through to the service and answer the browser with what
 * it says.
 *
 * @param request The browser's request — its body is forwarded, its abort signal is the
 *   browser's leaving.
 * @param ids Every id the path carries; each must be a uuid.
 * @param path The service's path, built from those ids.
 * @param options The wiring tests replace.
 * @returns The reply's stream under {@link STREAM_HEADERS}; the service's JSON answer or refusal
 *   with its status; a `403` for another site's request, a `422` for an id that is not a uuid
 *   and a `413` for an oversized body, each before anything is sent; or a `502` when the service
 *   could not be reached. Never a throw.
 */
export async function passCopilotWrite(
  request: Request,
  ids: readonly string[],
  path: string,
  options: CopilotPassOptions = {},
): Promise<Response> {
  if (!sameOrigin(request.headers)) return refuse(403, CROSS_ORIGIN_CODE, CROSS_ORIGIN);
  if (!ids.every(isCopilotId)) return refuse(422, COPILOT_REQUEST_INVALID_CODE, COPILOT_ID_INVALID);

  const body = await request.text();
  if (new TextEncoder().encode(body).length > MAX_BODY_BYTES) {
    return refuse(413, COPILOT_REQUEST_INVALID_CODE, COPILOT_BODY_TOO_LARGE);
  }

  const {
    fetcher = (input, init) => fetch(input, init),
    baseUrl = restUrl(),
    cookie = async () => sessionCookieHeader(await sessionCookies()),
    timeoutMs = COPILOT_TIMEOUT_MS,
  } = options;

  // The deadline is for the first byte; the stream itself lives as long as the reply and the
  // reader do. The browser's leaving ends it too.
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
      method: "POST",
      headers,
      body: body === "" ? undefined : body,
      cache: "no-store",
      signal: deadline.signal,
    });
  } catch {
    request.signal.removeEventListener("abort", onLeave);
    return refuse(502, COPILOT_UNAVAILABLE_CODE, UNREACHABLE_COPILOT);
  } finally {
    clearTimeout(timer);
  }

  const type = upstream.headers.get("Content-Type") ?? "application/json";
  if (upstream.ok && type.startsWith(SSE_MEDIA_TYPE)) {
    return new Response(upstream.body, { status: 200, headers: STREAM_HEADERS });
  }

  // A JSON answer — the started session, or a refusal — ends here: nothing is left to abort.
  request.signal.removeEventListener("abort", onLeave);
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "Content-Type": type, "Cache-Control": CACHE_CONTROL },
  });
}
