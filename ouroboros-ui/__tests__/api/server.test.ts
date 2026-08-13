import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The two modules under `app/api/` that are not server-only import statically; the
// module under test cannot, because the mocks below have to be in place first.
import { SESSION_CACHE_COOKIE, SESSION_COOKIE } from "@/app/api/client";
import { ApiError } from "@/app/api/errors";
import { ACTIVE_TENANT_COOKIE } from "@/app/api/tenant";

// `app/api/server.ts` is server-only three times over, and each has to be answered before
// it can be imported here at all:
//
//   * `server-only` throws by design outside a React Server Component;
//   * `next/headers` reads the cookies of a request this suite is not inside;
//   * `next/navigation`'s `redirect` signals to a framework that is not running.
//
// So the two Next.js modules are replaced by the smallest things that behave like them —
// a cookie jar and a spy — which is what lets the wiring be tested at all. What is under
// test is this module's own decisions: which cookie, which attributes, what a corrupted
// value means, and that a 401 really does route to login.

vi.mock("server-only", () => ({}));

/** The cookies of the request under test, and what the code wrote back to them. */
const jar = new Map<string, string>();
const setCookie = vi.fn<(name: string, value: string, options: unknown) => void>();
const deleteCookie = vi.fn<(name: string) => void>();

vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
      set: setCookie,
      delete: deleteCookie,
    }),
}));

/** What `redirect()` does: signal by throwing, so nothing after it runs. */
class RedirectSignal extends Error {
  constructor(readonly to: string) {
    super(`NEXT_REDIRECT ${to}`);
  }
}
const redirect = vi.fn((to: string) => {
  throw new RedirectSignal(to);
});

vi.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to) }));

const {
  ACTIVE_TENANT_MAX_AGE,
  LOGIN_PATH,
  activeTenant,
  anonymousApi,
  api,
  clearActiveTenant,
  resetApiClient,
  setActiveTenant,
} = await import("@/app/api/server");
const { REST_URL_VAR, resetRestUrlCache } = await import("@/app/env");

/** The base URL the client is expected to build against. */
const BASE_URL = "http://rest.test:4000";

/** Every request the stubbed global `fetch` was handed. */
let requests: Request[] = [];

/**
 * Answer every call with one response.
 *
 * `api()` takes no `fetch` — that is the point of it, it is the wired client — so the
 * global is what a test replaces.
 *
 * @param response What the service answers with.
 */
function respondWith(response: Response): void {
  vi.stubGlobal("fetch", (request: Request) => {
    requests.push(request);
    return Promise.resolve(response.clone());
  });
}

beforeEach(() => {
  vi.stubEnv(REST_URL_VAR, BASE_URL);
  requests = [];
});

afterEach(() => {
  jar.clear();
  setCookie.mockClear();
  deleteCookie.mockClear();
  redirect.mockClear();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetApiClient();
  resetRestUrlCache();
});

describe("activeTenant", () => {
  it("reads the workspace the browser was last given", async () => {
    jar.set(ACTIVE_TENANT_COOKIE, "acme");
    await expect(activeTenant()).resolves.toBe("acme");
  });

  it("is undefined when nothing has been chosen", async () => {
    await expect(activeTenant()).resolves.toBeUndefined();
  });

  it("treats an unreadable cookie as no choice rather than as an error", async () => {
    // A cookie is whatever the browser was last given. An edited one must not be able to
    // stop the application rendering: without the header the service either infers the
    // caller's sole workspace or answers 422 tenant_required, and both are recoverable.
    jar.set(ACTIVE_TENANT_COOKIE, "acme robotics; drop table");
    await expect(activeTenant()).resolves.toBeUndefined();
  });

  it("treats an empty cookie as no choice", async () => {
    jar.set(ACTIVE_TENANT_COOKIE, "");
    await expect(activeTenant()).resolves.toBeUndefined();
  });
});

describe("setActiveTenant", () => {
  it("writes the choice where the next request will read it", async () => {
    await setActiveTenant("acme");

    expect(setCookie).toHaveBeenCalledWith(ACTIVE_TENANT_COOKIE, "acme", expect.anything());
  });

  it("keeps the cookie out of script's reach and off cross-site requests", async () => {
    await setActiveTenant("acme");

    const [, , options] = setCookie.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(options).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: ACTIVE_TENANT_MAX_AGE,
    });
  });

  it("does not require TLS in development, where there is none to require", async () => {
    await setActiveTenant("acme");

    const [, , options] = setCookie.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(options).toMatchObject({ secure: false });
  });

  it("refuses a reference the contract would not accept, because a write is our own doing", async () => {
    await expect(setActiveTenant("acme robotics")).rejects.toThrow(/X-Ouro-Tenant/);
    expect(setCookie).not.toHaveBeenCalled();
  });
});

describe("clearActiveTenant", () => {
  it("removes the choice", async () => {
    await clearActiveTenant();

    expect(deleteCookie).toHaveBeenCalledWith(ACTIVE_TENANT_COOKIE);
  });
});

describe("api", () => {
  it("calls the service configured in the environment", async () => {
    respondWith(new Response(JSON.stringify({ items: [], total: 0, limit: 25, offset: 0 })));

    await api().GET("/api/v1/tenants");

    expect(requests[0]?.url).toBe(`${BASE_URL}/api/v1/tenants`);
  });

  it("names the variable when the environment does not carry it", () => {
    vi.stubEnv(REST_URL_VAR, "");
    resetRestUrlCache();

    expect(() => api()).toThrow(REST_URL_VAR);
  });

  it("forwards this request's session and workspace", async () => {
    jar.set(SESSION_COOKIE, "signed.value");
    jar.set(ACTIVE_TENANT_COOKIE, "acme");
    respondWith(new Response(JSON.stringify({ items: [], total: 0, limit: 25, offset: 0 })));

    await api().GET("/api/v1/tenants");

    expect(requests[0]?.headers.get("Cookie")).toBe(`${SESSION_COOKIE}=signed.value`);
    expect(requests[0]?.headers.get("X-Ouro-Tenant")).toBe("acme");
  });

  it("forwards both of BetterAuth's cookies when the browser sent both", async () => {
    // The pair `app/api/auth-client.ts` already forwards: the token, and the signed
    // snapshot the service answers from without a database lookup. This is the point where
    // the two clients agree about a credential — #720 is what happened when they did not.
    jar.set(SESSION_COOKIE, "signed.value");
    jar.set(SESSION_CACHE_COOKIE, "cached.snapshot");
    respondWith(new Response(JSON.stringify({ items: [], total: 0, limit: 25, offset: 0 })));

    await api().GET("/api/v1/tenants");

    expect(requests[0]?.headers.get("Cookie")).toBe(
      `${SESSION_COOKIE}=signed.value; ${SESSION_CACHE_COOKIE}=cached.snapshot`,
    );
  });

  it("sends no cookie header for a request carrying neither", async () => {
    respondWith(new Response(JSON.stringify({ items: [], total: 0, limit: 25, offset: 0 })));

    await api().GET("/api/v1/tenants");

    expect(requests[0]?.headers.has("Cookie")).toBe(false);
  });

  it("reads the cookies of each request rather than the ones it was built with", async () => {
    // One client serves the whole process; the session and the workspace are per call.
    // A client that captured them at construction would serve one visitor's session to
    // the next request the process handled.
    respondWith(new Response(JSON.stringify({ items: [], total: 0, limit: 25, offset: 0 })));
    const client = api();

    await client.GET("/api/v1/tenants");
    jar.set(SESSION_COOKIE, "second.visitor");
    await client.GET("/api/v1/tenants");

    expect(requests[0]?.headers.has("Cookie")).toBe(false);
    expect(requests[1]?.headers.get("Cookie")).toBe(`${SESSION_COOKIE}=second.visitor`);
  });

  it("builds one client and keeps it", () => {
    expect(api()).toBe(api());
  });

  it("routes a 401 to the login screen", async () => {
    respondWith(
      new Response(
        JSON.stringify({ code: "unauthenticated", message: "Sign in.", details: {} }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(api().GET("/api/v1/tenants")).rejects.toBeInstanceOf(RedirectSignal);
    expect(redirect).toHaveBeenCalledWith(LOGIN_PATH);
    expect(LOGIN_PATH).toBe("/login");
  });

  it("leaves every other failure to the caller, as an ApiError", async () => {
    respondWith(
      new Response(
        JSON.stringify({ code: "tenant_not_found", message: "No such tenant.", details: {} }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(
      api().GET("/api/v1/tenants/{tenantId}", {
        params: { path: { tenantId: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10" } },
      }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(redirect).not.toHaveBeenCalled();
  });
});

/**
 * The second client, for the one screen that has to be able to hear a `401`.
 *
 * Everything about it is {@link api}'s except the handling of that one status, and the two
 * cases below are exactly that difference: the credentials still travel, and the failure
 * arrives as an error rather than as a redirect to the page that asked.
 */
describe("anonymousApi", () => {
  it("forwards the same session and workspace as the wired client does", async () => {
    jar.set(SESSION_COOKIE, "signed.value");
    jar.set(ACTIVE_TENANT_COOKIE, "acme");
    respondWith(new Response(JSON.stringify({ items: [], total: 0, limit: 25, offset: 0 })));

    await anonymousApi().GET("/api/v1/tenants");

    expect(requests[0]?.headers.get("Cookie")).toBe(`${SESSION_COOKIE}=signed.value`);
    expect(requests[0]?.headers.get("X-Ouro-Tenant")).toBe("acme");
  });

  it("lets a 401 reject as an ApiError instead of redirecting to the login screen", async () => {
    // For a caller on the login screen, `api()`'s handler would send the request to
    // LOGIN_PATH — which is the page asking — once per render, for every signed-out
    // visitor. Any route in the generated family demonstrates it; this was `/auth/me` until
    // [#711](https://github.com/NobuData/ouroboros/issues/711) deleted that route.
    respondWith(
      new Response(
        JSON.stringify({ code: "unauthenticated", message: "Sign in.", details: {} }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      ),
    );

    const caught: unknown = await anonymousApi()
      .GET("/api/v1/tenants")
      .catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).isUnauthenticated).toBe(true);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("builds one client and keeps it, separately from the wired one", () => {
    expect(anonymousApi()).toBe(anonymousApi());
    expect(anonymousApi()).not.toBe(api());
  });

  it("is forgotten by resetApiClient too, so a suite can rebuild both", () => {
    const before = anonymousApi();
    resetApiClient();

    expect(anonymousApi()).not.toBe(before);
  });
});
