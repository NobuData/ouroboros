/**
 * The typed client over `ouroboros-rest`, and the four things every call needs.
 *
 * `openapi-fetch` gives the typing: a `GET` of a path the contract does not describe, a
 * query parameter it does not accept, or a field a response does not carry is a
 * compile error, against types generated from the committed specification
 * (`yarn api:sync` → `app/api/schema.d.ts`). What it does not give is anything about
 * *this* API, and that is what this module adds, once, so no call site repeats it:
 *
 * 1. **The base URL**, from `OURO_REST_URL` — supplied by the caller, because reading the
 *    environment is `app/env.ts`'s job and doing it here would make this module
 *    server-only for a reason that has nothing to do with fetching.
 * 2. **The session**, forwarded as the `ouro_session` cookie the contract names.
 * 3. **The active workspace**, as the `X-Ouro-Tenant` header (`app/api/tenant.ts`).
 * 4. **The error envelope**, parsed into an {@link ApiError} and thrown — including the
 *    `401` that means the session is gone, which is handed to `onUnauthenticated` first
 *    so the caller can route to the login screen.
 *
 * This module is a **factory and nothing else**: it reads no environment, touches no
 * `next/headers`, and holds no module state. That is what makes it testable against a
 * stub `fetch` with no framework in the way, and it is why the wiring — the real
 * environment, the real cookies, the real redirect — lives in `app/api/server.ts`.
 */

import createClient, { type Client, type Middleware } from "openapi-fetch";

import { ApiError } from "@/app/api/errors";
import type { paths } from "@/app/api/schema";
import { TENANT_HEADER, assertTenantReference } from "@/app/api/tenant";

/**
 * The session cookie, as `ouroboros-rest` issues and reads it
 * (`openapi.yaml` § `components.securitySchemes.ouroSession`).
 */
export const SESSION_COOKIE = "ouro_session";

/** Where a workspace reference comes from, per request. `undefined` sends no header. */
export type TenantResolver = () => string | undefined | Promise<string | undefined>;

/** Where the session cookie's value comes from, per request. `undefined` sends none. */
export type SessionResolver = () => string | undefined | Promise<string | undefined>;

/**
 * What to do about a `401` before it is thrown.
 *
 * It runs *first*, so a handler that navigates away — `redirect()` in a Server Component
 * — wins over the throw, and a handler that only logs still leaves the caller an
 * {@link ApiError} to catch.
 */
export type UnauthenticatedHandler = (error: ApiError) => void | Promise<void>;

/** How to build a client. Only `baseUrl` is required; the rest is wiring. */
export interface ApiClientOptions {
  /** Base URL of `ouroboros-rest`, without a trailing slash — `app/env.ts` supplies it. */
  baseUrl: string;
  /** The active workspace, read per request. */
  tenant?: TenantResolver;
  /** The signed-in session, read per request. */
  session?: SessionResolver;
  /** Called with the {@link ApiError} of every `401`, before it is thrown. */
  onUnauthenticated?: UnauthenticatedHandler;
  /** Replaces `globalThis.fetch`. Tests pass a stub; production passes nothing. */
  fetch?: (input: Request) => Promise<Response>;
}

/** The generated client: every operation the contract describes, and nothing else. */
export type ApiClient = Client<paths>;

/**
 * What a cookie value may contain, per RFC 6265 § 4.1.1.
 *
 * Printable ASCII without space, double quote, comma, semicolon and backslash. The
 * session value arrives from the browser and leaves in a header this client composes, so
 * this is the check that keeps a `\r\n` in a forged cookie from becoming two headers.
 */
const COOKIE_VALUE_PATTERN = /^[!#-+\--:<-[\]-~]*$/;

/**
 * Check a cookie value on its way into a request header.
 *
 * @param value The raw value read from the incoming request.
 * @returns The value, unchanged.
 * @throws {Error} If it carries a character a cookie value may not. The message quotes
 *   the cookie's name and never its value — this is a credential.
 */
function assertCookieValue(value: string): string {
  if (!COOKIE_VALUE_PATTERN.test(value)) {
    throw new Error(
      `The ${SESSION_COOKIE} cookie carries a character a cookie value may not ` +
        `(RFC 6265 § 4.1.1) and was not forwarded.`,
    );
  }
  return value;
}

/**
 * Build the middleware that adds the credentials and reads the failures.
 *
 * Split out from {@link createApiClient} only to keep each half readable: this is the
 * whole of what the wrapper does to a request and a response.
 *
 * @param options The client's options.
 * @returns The single middleware the client registers.
 */
function credentialsAndErrors(options: ApiClientOptions): Middleware {
  return {
    async onRequest({ request }) {
      const tenant = await options.tenant?.();
      if (tenant !== undefined) {
        request.headers.set(TENANT_HEADER, assertTenantReference(tenant));
      }

      // Only the session cookie, never the whole `Cookie` header of the incoming
      // request: the browser's other cookies — the theme, the active workspace — are
      // this UI's business and none of `ouroboros-rest`'s, and a client that forwarded
      // them wholesale would leak every future cookie to a service that never asked.
      const session = await options.session?.();
      if (session !== undefined) {
        request.headers.set("Cookie", `${SESSION_COOKIE}=${assertCookieValue(session)}`);
      }

      return request;
    },

    async onResponse({ response }) {
      if (response.ok) {
        return;
      }

      const error = await ApiError.fromResponse(response);

      // Before the throw, deliberately: a handler that redirects raises its own control
      // -flow error, and that is the one that should reach the caller — the page is
      // going to the login screen, not rendering a message about a session it no longer
      // has.
      if (error.isUnauthenticated) {
        await options.onUnauthenticated?.(error);
      }

      throw error;
    },
  };
}

/**
 * Build a client for `ouroboros-rest`.
 *
 * Every call it returns either resolves with the response the contract describes or
 * rejects with an {@link ApiError} — there is no third outcome to branch on, which is
 * what lets a screen `await` a call and let the error boundary have the rest.
 *
 * @param options Base URL, and the wiring for the session, the workspace and the `401`.
 * @returns The typed client. Cheap to build; the caller decides whether to keep one.
 */
export function createApiClient(options: ApiClientOptions): ApiClient {
  const client = createClient<paths>({
    baseUrl: options.baseUrl,
    // For the browser, which sends no cookie cross-origin unless asked. On the server it
    // is inert — nothing there has a cookie jar — which is why the session is forwarded
    // explicitly above rather than left to this.
    credentials: "include",
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });

  client.use(credentialsAndErrors(options));
  return client;
}

/**
 * One call's outcome, as `openapi-fetch` reports it.
 *
 * Narrower than its own `FetchResponse`, and only for {@link unwrap}'s signature: the
 * point is that `data` is present exactly when `error` is not.
 */
export type ApiResult<T> =
  | { data: T; response: Response }
  | { error: unknown; response: Response };

/**
 * Take the body out of a call that answers with one.
 *
 * `openapi-fetch` reports failures in the result rather than by rejecting; the middleware
 * above has already turned every one of those into a thrown {@link ApiError}, so by the
 * time a result reaches here it can only be a success — and this is the line that says so
 * to the type system, instead of a `!` at every call site.
 *
 * `NonNullable<T>` rather than `T` because `openapi-fetch` types the body of a call that
 * *may* answer `204` as possibly absent; the check below is what turns that maybe into a
 * value, and the return type says so.
 *
 * @param result The awaited result of a client call.
 * @returns Its body, typed as the contract declares it.
 * @throws {ApiError} If the response carried no body. That is not a failure this client
 *   can paper over: an operation answering `204` has nothing to return, and calling this
 *   on one is a mistake at the call site rather than something the service did.
 */
export function unwrap<T>(result: ApiResult<T>): NonNullable<T> {
  if (!("data" in result) || result.data == null) {
    throw new ApiError(
      result.response.status,
      "client_empty_response",
      `ouroboros-rest answered ${result.response.status} with no body, and this call ` +
        `expected one.`,
      {},
      result.response.url || undefined,
    );
  }
  return result.data;
}
