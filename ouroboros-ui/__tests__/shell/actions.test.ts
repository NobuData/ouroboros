import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ACTIVE_TENANT_COOKIE } from "@/app/api/tenant";
import { AUTH_COOKIES } from "@/app/api/auth-client";
import { resetRestUrlCache } from "@/app/env";
import { LOGIN_PATH } from "@/app/paths";

/**
 * The one write the app shell makes: signing out
 * ([#721](https://github.com/NobuData/ouroboros/issues/721)).
 *
 * The action itself is two lines over `signOutSession()`, and the reason it is worth a suite
 * of its own is the criterion behind it: *sign out → `/login`, with the session revoked
 * server-side — **not merely cleared client-side***. Three things have to happen and only the
 * first is BetterAuth's, so each of them is a case here:
 *
 * 1. `POST /api/auth/sign-out` is called, which is what deletes the session **row** — a
 *    session only forgotten by the browser is a session a copied cookie still opens.
 * 2. Both auth cookies are deleted from *this* response, because the library's own
 *    `Set-Cookie` reaches this process rather than the browser.
 * 3. `ouro_tenant` goes with them, so the next person on this browser is asked where the loop
 *    runs instead of being sent straight past the question.
 *
 * And the fourth, which is the one a person sees: the browser lands on `/login`.
 */

/** The cookies of the request under test. */
const jar = new Map<string, string>();
const deleteCookie = vi.fn<(name: string) => void>();

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
      set: () => {},
      delete: deleteCookie,
    }),
  // A Server Action's request always carries one, and `app/api/auth-server.ts` forwards it so
  // BetterAuth's origin check is satisfied on a write this process composes.
  headers: () => Promise.resolve(new Headers({ origin: "http://localhost:3000" })),
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

const { signOutOfSession } = await import("@/app/shell/actions");

/** The base URL every request below is expected to be built against. */
const BASE_URL = "http://rest.test:4000";

/** Every URL the stubbed global `fetch` was handed. */
let urls: string[] = [];

/** What the service answers a sign-out with, for this case. */
let answer: { status: number; body: unknown } = { status: 200, body: {} };

beforeEach(() => {
  jar.clear();
  for (const name of AUTH_COOKIES) jar.set(name, "a-cookie");
  jar.set(ACTIVE_TENANT_COOKIE, "acme-robotics");

  deleteCookie.mockClear();
  redirect.mockClear();
  urls = [];
  answer = { status: 200, body: {} };
  resetRestUrlCache();
  process.env.OURO_REST_URL = BASE_URL;

  vi.stubGlobal("fetch", (input: Request | URL | string) => {
    urls.push(input instanceof Request ? input.url : String(input));

    return Promise.resolve(
      new Response(JSON.stringify(answer.body), {
        status: answer.status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.OURO_REST_URL;
  resetRestUrlCache();
});

/**
 * Sign out, absorbing the redirect the action always ends with.
 *
 * @returns Nothing. What was asked for is in `urls`, `deleteCookie` and `redirect`.
 */
async function signOut(): Promise<void> {
  await expect(signOutOfSession()).rejects.toBeInstanceOf(RedirectSignal);
}

describe("signOutOfSession", () => {
  it("revokes the session server-side rather than forgetting it here", async () => {
    await signOut();

    expect(urls).toContain(`${BASE_URL}/api/auth/sign-out`);
  });

  it("deletes both auth cookies from this response", async () => {
    // The library's own `Set-Cookie` arrives at this process and stops, because the call was
    // made by the server. Nothing but this clears them.
    await signOut();

    for (const name of AUTH_COOKIES) {
      expect(deleteCookie).toHaveBeenCalledWith(name);
    }
  });

  it("forgets the step-2 hint, so the next person is asked where the loop runs", async () => {
    await signOut();

    expect(deleteCookie).toHaveBeenCalledWith(ACTIVE_TENANT_COOKIE);
  });

  it("lands on the login screen with no return-to", async () => {
    // No `?next=`: the page being left is one this browser may no longer see, so sending
    // somebody back to it after signing in again would be a guess dressed as a courtesy.
    await signOut();

    expect(redirect).toHaveBeenCalledWith(LOGIN_PATH);
  });

  it("still clears this browser when the service refuses the call", async () => {
    // An expired session answers `401`, and a refusal is not a reason to stay signed in on
    // this browser: the cookies are what this request can actually do something about.
    answer = { status: 401, body: { message: "Session expired", code: "UNAUTHORIZED" } };

    await signOut();

    expect(deleteCookie).toHaveBeenCalledWith(ACTIVE_TENANT_COOKIE);
    expect(redirect).toHaveBeenCalledWith(LOGIN_PATH);
  });

  it("signs out a request that carries no session at all", async () => {
    // A hand-made POST, or a second press after the first one landed. There is no reference
    // to resolve and nothing to refuse: the transport *is* the authority here.
    jar.clear();

    await signOut();

    expect(redirect).toHaveBeenCalledWith(LOGIN_PATH);
  });
});
