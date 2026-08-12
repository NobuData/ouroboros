import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ACTIVE_TENANT_COOKIE } from "@/app/api/tenant";
import { resetRestUrlCache } from "@/app/env";
import { LOGIN_PATH } from "@/app/paths";

/**
 * The data-access layer: who is signed in, which workspace they are in, and the gate every
 * screen in `app/(app)` goes through.
 *
 * This is the security-relevant half of #44, so what is tested is not "does it call
 * `/auth/me`" but the four decisions it makes about the answer: a `401` is *signed out*, a
 * `500` is not, the cookie is a claim rather than a fact, and a request without both halves
 * does not get to render.
 *
 * The environment it needs is the same one `server.test.ts` builds — a cookie jar, a
 * redirect that signals by throwing — plus a `fetch` for the one call the layer makes.
 */

/** The cookies of the request under test. */
const jar = new Map<string, string>();

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
      set: () => {},
      delete: () => {},
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

// `connection()` is how the data-access layer says "this needs a request", which is what
// keeps `next build` from prerendering a screen that depends on who is asking. Outside a
// Next.js request scope it throws by design, so here it is the no-op it would be inside one.
vi.mock("next/server", () => ({ connection: () => Promise.resolve() }));

const { currentAccess, requireWorkspace } = await import("@/app/api/access");
const { resetApiClient } = await import("@/app/api/server");

/** One membership, with the fields a case cares about overridden. */
const ACME = {
  tenantId: "5eed0001-0000-4000-8000-000000000001",
  slug: "acme-robotics",
  displayName: "Acme Robotics",
  status: "active",
  role: "owner",
  invitedAt: "2026-08-11T10:20:23.114Z",
  joinedAt: "2026-08-11T10:20:23.114Z",
};

/** A session carrying the given memberships. */
function session(memberships: unknown[] = [ACME]) {
  return {
    user: {
      id: "5eed0003-0000-4000-8000-000000000001",
      email: "ken@acme-robotics.dev",
      displayName: "Ken Suenobu",
      avatarUrl: null,
      createdAt: "2026-08-11T10:20:23.114Z",
      updatedAt: "2026-08-11T10:20:23.114Z",
    },
    memberships,
    tenantSuggestion: null,
  };
}

/** What the stubbed service answers `/auth/me` with, and how many times it was asked. */
let answer: { body: unknown; status: number };
let calls: number;

beforeEach(() => {
  jar.clear();
  redirect.mockClear();
  resetApiClient();
  resetRestUrlCache();
  process.env.OURO_REST_URL = "http://rest.test:4000";

  answer = { body: session(), status: 200 };
  calls = 0;

  vi.stubGlobal("fetch", () => {
    calls += 1;
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
  resetApiClient();
});

describe("currentAccess, with no session", () => {
  it("reads a 401 as nobody signed in rather than as a failure", async () => {
    answer = {
      body: { code: "unauthenticated", message: "Sign in first.", details: {} },
      status: 401,
    };

    expect(await currentAccess()).toEqual({ session: null, membership: undefined });
  });

  it("does not redirect, because the screen asking is the one it would redirect to", async () => {
    answer = { body: { code: "unauthenticated", message: "no", details: {} }, status: 401 };

    await currentAccess();

    expect(redirect).not.toHaveBeenCalled();
  });

  it("lets any other failure reject, so an outage is not shown as a sign-in screen", async () => {
    answer = { body: { code: "internal_error", message: "…", details: {} }, status: 500 };

    await expect(currentAccess()).rejects.toMatchObject({ status: 500 });
  });
});

describe("currentAccess, with a session", () => {
  it("resolves the workspace the cookie names", async () => {
    jar.set(ACTIVE_TENANT_COOKIE, ACME.slug);

    const access = await currentAccess();

    expect(access.session?.user.email).toBe("ken@acme-robotics.dev");
    expect(access.membership?.slug).toBe(ACME.slug);
  });

  it("treats no cookie as no choice — a step to complete rather than an error", async () => {
    const access = await currentAccess();

    expect(access.session).not.toBeNull();
    expect(access.membership).toBeUndefined();
  });

  it("treats a cookie naming a workspace they do not belong to as no choice", async () => {
    // The property that matters: the cookie is whatever the browser was last given, so it is
    // matched against what the service just said rather than believed.
    jar.set(ACTIVE_TENANT_COOKIE, "someone-elses-workspace");

    expect((await currentAccess()).membership).toBeUndefined();
  });

  it("treats an unreadable cookie as no choice rather than as a reason to fail", async () => {
    // `activeTenant()` refuses a value that is not a workspace reference at all; a bad
    // cookie must not be able to stop the application rendering.
    jar.set(ACTIVE_TENANT_COOKIE, "not a reference\r\n");

    expect((await currentAccess()).membership).toBeUndefined();
  });

  it("treats a suspended workspace as no choice", async () => {
    answer = { body: session([{ ...ACME, status: "suspended" }]), status: 200 };
    jar.set(ACTIVE_TENANT_COOKIE, ACME.slug);

    expect((await currentAccess()).membership).toBeUndefined();
  });
});

describe("requireWorkspace", () => {
  it("returns the session and the workspace when both are there", async () => {
    jar.set(ACTIVE_TENANT_COOKIE, ACME.slug);

    const { session: current, membership } = await requireWorkspace();

    expect(current.user.displayName).toBe("Ken Suenobu");
    expect(membership.tenantId).toBe(ACME.tenantId);
  });

  it("sends a request with no session to the login screen", async () => {
    answer = { body: { code: "unauthenticated", message: "no", details: {} }, status: 401 };

    await expect(requireWorkspace()).rejects.toBeInstanceOf(RedirectSignal);
    expect(redirect).toHaveBeenCalledWith(LOGIN_PATH);
  });

  it("sends a signed-in request with no chosen workspace to the login screen too", async () => {
    // A session alone is not access: every operation the product needs is scoped to a
    // workspace, and the login screen is where one is chosen.
    await expect(requireWorkspace()).rejects.toBeInstanceOf(RedirectSignal);
    expect(redirect).toHaveBeenCalledWith(LOGIN_PATH);
  });

  it("signals by throwing, so nothing after a failed check runs", async () => {
    const caught: unknown = await requireWorkspace().catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(RedirectSignal);
    expect((caught as RedirectSignal).to).toBe(LOGIN_PATH);
  });
});

describe("repeated calls in one request", () => {
  it("answer the same thing, whether or not the render scope deduplicated them", async () => {
    // React's `cache` memoises for the length of a *request*, and there is no request here:
    // outside a render scope it is a pass-through, so the number of calls to the service is
    // the framework's guarantee rather than something this suite can observe. What it can
    // observe is the part that would break either way — that two calls agree.
    jar.set(ACTIVE_TENANT_COOKIE, ACME.slug);

    const [first, second] = await Promise.all([currentAccess(), currentAccess()]);

    expect(first).toEqual(second);
    expect(calls).toBeGreaterThanOrEqual(1);
  });
});
