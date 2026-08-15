/**
 * The scripted half of the suite — requests to `ouroboros-rest`, as a caller makes them.
 *
 * Issue [#56](https://github.com/NobuData/ouroboros/issues/56) describes these legs as
 * *scripted curl*. They are Playwright's own request client instead, and the difference is
 * only in what runs them: the same method, path, headers and body go over the wire, but
 * one runner owns the whole suite — so there is one report, one wall-clock budget to
 * enforce (`SUITE_BUDGET_MS`), and a failing API leg produces the same annotated output a
 * failing browser leg does rather than a non-zero exit status and a blob of JSON.
 *
 * Nothing here knows anything about the service beyond its address and its error
 * envelope. The paths are written out at each call site rather than being wrapped in a
 * client, deliberately: the generated client in `ouroboros-ui/app/api/` already proves the
 * UI and the contract agree, and a second one here would let a suite that is supposed to
 * be checking the deployment pass because two copies of the same assumption matched.
 */

import { type APIRequestContext, type APIResponse, expect } from "@playwright/test";

import { SESSION_COOKIE } from "./session";
import { REST_URL } from "./stack";

/**
 * The error envelope every failure from `ouroboros-rest` carries.
 *
 * Mirrored rather than imported: it is the *contract*, so a suite that read the service's
 * own type would stop noticing a change to it. Only the two fields an assertion message
 * needs are here.
 */
interface ErrorEnvelope {
  /** The stable machine-readable reason, e.g. `engine_unavailable`. */
  readonly code?: string;
  /** The human-readable sentence, which never names an internal address. */
  readonly message?: string;
}

/**
 * Resolve a path against `ouroboros-rest`'s published origin.
 *
 * @param path - An absolute path, beginning with a slash — `/api/v1/tenants`.
 * @returns The absolute URL.
 */
export function restUrl(path: string): string {
  return `${REST_URL}${path}`;
}

/**
 * Read a response's body as text, whatever it turned out to be.
 *
 * Used only to build a failure message, so it must not itself fail: a gateway's HTML error
 * page and an empty body are both things a broken stack answers with, and a helper that
 * threw on them would replace the useful failure with a useless one.
 *
 * @param response - The response to read.
 * @returns Its body, or a note saying it could not be read.
 */
async function bodyText(response: APIResponse): Promise<string> {
  try {
    const text = await response.text();

    return text === "" ? "<empty body>" : text;
  } catch {
    return "<unreadable body>";
  }
}

/**
 * Describe a response well enough to debug it from a CI log.
 *
 * A smoke suite fails on a machine nobody is sitting at, so the failure message is the
 * whole of the diagnosis. Url, status, status text and body — which together say which
 * service answered and what it thought was wrong. The request's method is not among them
 * because `APIResponse` does not carry it; the url and the assertion's own line number are
 * what identify the call.
 *
 * @param response - The response to describe.
 * @returns Two lines of context, prefixed with a newline so they read under the assertion.
 */
export async function describe(response: APIResponse): Promise<string> {
  const status = `${response.status()} ${response.statusText()}`.trim();

  return `\n  ${response.url()} → ${status}\n  ${await bodyText(response)}`;
}

/**
 * Assert a response succeeded, and parse it.
 *
 * @param response - What the service answered.
 * @param status - The status the contract documents for this call. Named explicitly rather
 *   than accepting any 2xx: `201` and `200` mean different things on
 *   `POST /api/v1/tenants`, and a route that started answering the other one has changed
 *   its contract.
 * @returns The parsed body, typed as the caller says it is. The cast is the boundary this
 *   suite deliberately does not close — see this module's header for why there is no
 *   generated client here.
 * @throws When the status differs, with the body in the message.
 */
export async function expectJson<T>(response: APIResponse, status: number): Promise<T> {
  expect(response.status(), await describe(response)).toBe(status);

  return (await response.json()) as T;
}

/**
 * Assert a response failed the way the contract says it fails.
 *
 * @param response - What the service answered.
 * @param status - The documented status.
 * @param code - The documented `code` in the error envelope. This is what a client is asked
 *   to branch on (`ouroboros-ui/app/api/errors.ts`), so it is what a test asserts —
 *   matching on the message would break on a wording change that broke nothing.
 * @throws When either differs.
 */
export async function expectError(
  response: APIResponse,
  status: number,
  code: string,
): Promise<void> {
  const context = await describe(response);

  expect(response.status(), context).toBe(status);

  const envelope = (await response.json()) as ErrorEnvelope;

  expect(envelope.code, context).toBe(code);
}

/** Headers that carry a session on a scripted request. */
export function asUser(token: string): Record<string, string> {
  // The BetterAuth cookie (#703), by the name `support/session.ts` owns. This carried the
  // legacy `ouro_session` name until #647 first ran the signed-in API legs against the
  // stack — where every request wearing it answered 401, which is exactly what a forged
  // or stale credential should get and exactly why the parked legs needed to run.
  return { cookie: `${SESSION_COOKIE}=${token}` };
}

/**
 * `GET` a path with no session at all.
 *
 * Its own helper because "signed out" is an assertion in several specs and writing it as
 * an omitted argument is how it eventually stops being omitted.
 *
 * @param request - Playwright's request context.
 * @param path - The path to call.
 * @returns The response.
 */
export function getAnonymously(request: APIRequestContext, path: string): Promise<APIResponse> {
  return request.get(restUrl(path));
}
