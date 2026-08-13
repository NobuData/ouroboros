import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { REQUEST_PATH_HEADER } from "@/app/api/request";
import { DASHBOARD_PATH, LOGIN_PATH, RETURN_TO_PARAM } from "@/app/paths";

import { authAnswer, isAuthUrl, orgsAnswer, requestedUrl } from "./helpers/auth";
import { membership } from "./helpers/login";

/**
 * **The acceptance criterion of
 * [#720](https://github.com/NobuData/ouroboros/issues/720), as one test:** *deep link to
 * `/dashboard` while signed out → login → back to `/dashboard`*.
 *
 * Every part of that round trip is covered where it is decided — `proxy.test.ts` for the
 * header, `api/access.test.ts` for the gate, `login/page.test.tsx` for what the screen does
 * with `?next=` — and none of those suites can fail if the *seam between them* is wrong.
 * Three modules have to agree about one string here: the header `proxy.ts` writes, the
 * parameter `app/api/request.ts` composes, and the parameter `app/(auth)/login/page.tsx`
 * reads. This is the suite that would notice one of them being renamed.
 *
 * So nothing under test is replaced. What is replaced is the world around it: the request's
 * cookies and headers, `redirect()`, and a `fetch` answering the two calls a session is
 * composed from. The one seam left unjoined is the browser's — a redirect is followed by
 * hand, because following one is the browser's job and there is none here.
 *
 * **This is also where the round trip's *shape* is recorded.** It is a redirect and a
 * request, not a single call, and the return-to is the only thing carrying the visitor's
 * intention across the gap. A screen that lost it would still "work" in every other suite in
 * this repository — it would simply land everybody on the dashboard, which is where the
 * default goes.
 */

/** The cookies of the request under test. */
const jar = new Map<string, string>();

/** Its headers, including whatever `proxy.ts` stamped. */
const incoming = new Headers({ origin: "http://localhost:3000" });

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
      set: () => {},
      delete: () => {},
    }),
  headers: () => Promise.resolve(incoming),
}));

// `connection()` only — everything else in `next/server` is the real thing, because
// `proxy.ts` is one of the modules under test and builds a `NextResponse`.
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  connection: () => Promise.resolve(),
}));

/** Where the request was sent, if it was. */
let redirectedTo: string | undefined;

class RedirectSignal extends Error {}

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    redirectedTo = path;
    throw new RedirectSignal(path);
  },
}));

// The step-2 card the unsettled outcome renders submits to Server Actions, whose module
// reaches for `next/cache` and the server-only client. Not part of this round trip.
vi.mock("@/app/login/actions", () => ({
  enterMissionControl: vi.fn(),
  setWorkspaceEnabled: vi.fn(),
  discoverDomain: vi.fn(),
}));

const { proxy } = await import("@/proxy");
const { requireWorkspace } = await import("@/app/api/access");
const { resetApiClient } = await import("@/app/api/server");
const { default: LoginPage } = await import("@/app/(auth)/login/page");

/** The workspace this person belongs to, once they are signed in. */
const ACME = membership();

/** Whether the service reports a session for the request being served. */
let signedIn: boolean;

beforeEach(() => {
  jar.clear();
  incoming.delete(REQUEST_PATH_HEADER);
  redirectedTo = undefined;
  signedIn = false;
  resetApiClient();
  process.env.OURO_REST_URL = "http://rest.test:4000";

  vi.stubGlobal("fetch", (input: Request | URL | string) => {
    const url = requestedUrl(input);
    const memberships = signedIn ? [ACME] : null;

    return Promise.resolve(
      new Response(
        JSON.stringify(
          isAuthUrl(url) ? authAnswer(url, memberships) : orgsAnswer(memberships),
        ),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
  });
});

/**
 * Ask this origin for a page, the way a browser would.
 *
 * Runs the real `proxy.ts` and copies what it stamped onto the request the rest of the
 * modules then read — which is the hand-off Next.js performs between the two, and the
 * reason this file exists.
 *
 * @param path The path and query being asked for.
 */
function arriveAt(path: string): void {
  const response = proxy(new NextRequest(new URL(path, "http://localhost:3000")));
  const stamped = response.headers.get(`x-middleware-request-${REQUEST_PATH_HEADER}`);

  incoming.delete(REQUEST_PATH_HEADER);
  if (stamped !== null) incoming.set(REQUEST_PATH_HEADER, stamped);
}

/**
 * Render `/login` for the query string a redirect sent the browser to.
 *
 * @param to The path the previous step redirected to — `/login?next=…`.
 * @returns Nothing. The outcome is in {@link redirectedTo}, or in the absence of one.
 */
async function followToLogin(to: string): Promise<void> {
  const query = Object.fromEntries(new URL(to, "http://localhost:3000").searchParams);

  arriveAt(to);
  redirectedTo = undefined;
  await LoginPage({ searchParams: Promise.resolve(query) }).catch(() => undefined);
}

describe("a deep link followed while signed out", () => {
  it("comes back to the screen that was asked for", async () => {
    // 1. The browser asks for a screen in `(app)`. Nobody is signed in.
    arriveAt(DASHBOARD_PATH);

    await expect(requireWorkspace()).rejects.toBeInstanceOf(RedirectSignal);
    const sentTo = redirectedTo ?? "";

    expect(sentTo).toBe(`${LOGIN_PATH}?${RETURN_TO_PARAM}=${encodeURIComponent(DASHBOARD_PATH)}`);

    // 2. They sign in, and this browser has been through step 2 before.
    signedIn = true;
    jar.set("ouro_tenant", ACME.slug);

    // 3. The login screen sends them where they were going, rather than to its default.
    await followToLogin(sentTo);

    expect(redirectedTo).toBe(DASHBOARD_PATH);
  });

  it("carries the query it was made with, not just the path", async () => {
    arriveAt("/dashboard?tab=runs");

    await expect(requireWorkspace()).rejects.toBeInstanceOf(RedirectSignal);

    expect(redirectedTo).toBe(
      `${LOGIN_PATH}?${RETURN_TO_PARAM}=${encodeURIComponent("/dashboard?tab=runs")}`,
    );

    signedIn = true;
    jar.set("ouro_tenant", ACME.slug);
    await followToLogin(redirectedTo ?? "");

    expect(redirectedTo).toBe("/dashboard?tab=runs");
  });

  it("lands on the dashboard when there was nothing to come back to", async () => {
    // The behaviour before this issue, and still the behaviour for a request the proxy
    // never saw. It is the default rather than a failure.
    signedIn = true;
    jar.set("ouro_tenant", ACME.slug);

    await followToLogin(LOGIN_PATH);

    expect(redirectedTo).toBe(DASHBOARD_PATH);
  });
});

describe("a signed-in visitor who is already settled", () => {
  it("does not stop at the login screen at all", async () => {
    // The issue's second criterion. "Settled" rather than "has an active org" is
    // [#719](https://github.com/NobuData/ouroboros/issues/719)'s correction: every session
    // is stamped with an active organization at creation, so the pointer cannot also be the
    // evidence that somebody was asked where the loop runs.
    signedIn = true;
    jar.set("ouro_tenant", ACME.slug);

    await followToLogin(LOGIN_PATH);

    expect(redirectedTo).toBe(DASHBOARD_PATH);
  });

  it("is asked step 2 when this browser has not been through it", async () => {
    signedIn = true;

    await followToLogin(LOGIN_PATH);

    expect(redirectedTo).toBeUndefined();
  });
});
