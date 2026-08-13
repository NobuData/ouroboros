import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Membership } from "@/app/api/membership";
import { resetRestUrlCache } from "@/app/env";
import { LOGIN_PATH } from "@/app/paths";

import { authAnswer, isAuthUrl, orgsAnswer, requestedUrl } from "../helpers/auth";
import { membership } from "../helpers/login";

/**
 * The data-access layer: who is signed in, which workspace they are in, and the gate every
 * screen in `app/(app)` goes through.
 *
 * This is the security-relevant half of #44, so what is tested is not which routes it calls
 * but the four decisions it makes about the answer: *nobody signed in* is a state rather
 * than a failure, a `500` is not that state, **the session's pointer is a reference rather
 * than a fact**, and a request without both halves does not get to render.
 *
 * The third of those is where [#719](https://github.com/NobuData/ouroboros/issues/719)
 * changed the subject and not the rule. The active workspace was the `ouro_tenant` cookie,
 * and the cases below said so; it is `session."activeOrganizationId"` now — server state,
 * written only by `set-active` — and it is still resolved against the memberships the
 * service reported in the same request rather than believed. What the cookie can still do is
 * asserted in `server.test.ts` and `view.test.ts`, where what is left of it lives.
 *
 * The environment it needs is the same one `server.test.ts` builds — a cookie jar, a
 * redirect that signals by throwing — plus a `fetch` answering both families the layer reads
 * through. What they answer is `helpers/auth.ts`; what is decided about it is here.
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
  // The request's own headers. `app/api/auth-server.ts` reads the origin off them and
  // forwards it, which is what keeps BetterAuth's origin check satisfied on a call a
  // server composes rather than a browser.
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

// `connection()` is how the data-access layer says "this needs a request", which is what
// keeps `next build` from prerendering a screen that depends on who is asking. Outside a
// Next.js request scope it throws by design, so here it is the no-op it would be inside one.
vi.mock("next/server", () => ({ connection: () => Promise.resolve() }));

const { currentAccess, requireWorkspace } = await import("@/app/api/access");
const { resetApiClient } = await import("@/app/api/server");

/** The workspace every case is about, unless it says otherwise. */
const ACME: Membership = membership();

/** What this person belongs to. `null` is nobody signed in. */
let memberships: Membership[] | null;

/** Where the session is acting. `undefined` means "the first workspace", as a new one is. */
let acting: string | null | undefined;

/** A failure to answer every call with instead, when a case is about one. */
let failure: { body: unknown; status: number } | undefined;

/** How many requests the layer made — the number `cache` exists to hold down. */
let calls: number;

beforeEach(() => {
  jar.clear();
  redirect.mockClear();
  resetApiClient();
  resetRestUrlCache();
  process.env.OURO_REST_URL = "http://rest.test:4000";

  memberships = [ACME];
  acting = undefined;
  failure = undefined;
  calls = 0;

  vi.stubGlobal("fetch", (input: Request | URL | string) => {
    calls += 1;
    const url = requestedUrl(input);
    const answered = isAuthUrl(url)
      ? authAnswer(url, memberships, acting === undefined ? undefined : acting)
      : orgsAnswer(memberships);
    const body = failure === undefined ? answered : failure.body;

    return Promise.resolve(
      new Response(body === null ? "null" : JSON.stringify(body), {
        status: failure?.status ?? 200,
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
  it("reads the service's own null as nobody signed in", async () => {
    // Since [#711](https://github.com/NobuData/ouroboros/issues/711) this is the service's
    // answer rather than this layer's reading of a `401`: `GET /api/auth/get-session`
    // replies `null` for a request carrying no session, which is what makes *signed out* a
    // state the login screen can ask about rather than an error it has to translate.
    memberships = null;

    expect(await currentAccess()).toEqual({ session: null, membership: undefined });
  });

  it("does not redirect, because the screen asking is the one it would redirect to", async () => {
    memberships = null;

    await currentAccess();

    expect(redirect).not.toHaveBeenCalled();
  });

  it("asks nothing further, because there is nobody to ask about", async () => {
    // Including the workspace listing: a listing scoped to the caller has nothing to say
    // about a request that carries no caller.
    memberships = null;

    await currentAccess();

    expect(calls).toBe(1);
  });

  it("lets any failure reject, so an outage is not shown as a sign-in screen", async () => {
    // Every refusal now, not merely "any other": a `401` from these routes means the
    // request was refused, which is a different fact from *nobody is signed in*.
    failure = { body: { code: "INTERNAL_SERVER_ERROR", message: "…" }, status: 500 };

    await expect(currentAccess()).rejects.toMatchObject({ status: 500 });
  });
});

describe("currentAccess, with a session", () => {
  it("resolves the workspace the session's pointer names", async () => {
    const access = await currentAccess();

    expect(access.session?.user.email).toBe("ken@acme-robotics.dev");
    expect(access.membership?.slug).toBe(ACME.slug);
  });

  it("carries the memberships and the total the listing reported", async () => {
    // The rows are the session's since #719, so a screen drawing step 2 needs no read of
    // its own — and the total is what lets it say how many it left out.
    const { session } = await currentAccess();

    expect(session?.memberships).toHaveLength(1);
    expect(session?.membershipTotal).toBe(1);
    expect(session?.activeOrganizationId).toBe(ACME.id);
  });

  it("treats a session acting nowhere as no choice — a step to complete, not an error", async () => {
    acting = null;

    const access = await currentAccess();

    expect(access.session).not.toBeNull();
    expect(access.membership).toBeUndefined();
  });

  it("treats a pointer naming a workspace they do not belong to as no choice", async () => {
    // The property that matters, and the one the cookie used to carry: the reference is
    // matched against what the service just said rather than believed. A session may point
    // at a workspace somebody has since been removed from.
    acting = "5eed0001-0000-4000-8000-00000000dead";

    expect((await currentAccess()).membership).toBeUndefined();
  });

  it("resolves nothing at all for somebody who belongs nowhere", async () => {
    memberships = [];
    acting = null;

    const access = await currentAccess();

    expect(access.session?.memberships).toEqual([]);
    expect(access.membership).toBeUndefined();
  });
});

describe("requireWorkspace", () => {
  it("returns the session and the workspace when both are there", async () => {
    const { session: current, membership: workspace } = await requireWorkspace();

    expect(current.user.displayName).toBe("Ken Suenobu");
    expect(workspace.id).toBe(ACME.id);
  });

  it("sends a request with no session to the login screen", async () => {
    memberships = null;

    await expect(requireWorkspace()).rejects.toBeInstanceOf(RedirectSignal);
    expect(redirect).toHaveBeenCalledWith(LOGIN_PATH);
  });

  it("sends a signed-in request with no active workspace to the login screen too", async () => {
    // A session alone is not access: every operation the product needs is scoped to a
    // workspace, and the login screen is where one is chosen.
    acting = null;

    await expect(requireWorkspace()).rejects.toBeInstanceOf(RedirectSignal);
    expect(redirect).toHaveBeenCalledWith(LOGIN_PATH);
  });

  it("signals by throwing, so nothing after a failed check runs", async () => {
    acting = null;

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
    const [first, second] = await Promise.all([currentAccess(), currentAccess()]);

    expect(first).toEqual(second);
    expect(calls).toBeGreaterThanOrEqual(1);
  });
});
