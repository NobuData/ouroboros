import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthError } from "@/app/api/auth-client";
import { resetRestUrlCache } from "@/app/env";

// The resource sits on a server-only client, so importing it pulls in the same modules
// `server.test.ts` answers. The cookie jar below is the one the auth client reads.
vi.mock("server-only", () => ({}));

/** The cookies of the request under test. */
const jar = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
      set: () => {},
      delete: () => {},
    }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { session } = await import("@/app/api/session");

/**
 * The session resource — the three calls that answer one question.
 *
 * **Three calls answer one question now.**
 * [#711](https://github.com/NobuData/ouroboros/issues/711) deleted `GET /api/v1/auth/me`,
 * so what is asserted here is the composition that replaced it: which auth routes are
 * called, that the cookies BetterAuth reads are forwarded to them, and that the library's
 * vocabulary — `name`, `image`, an organization with no role on it — arrives as this
 * application's. The generated client is not involved and must not be: the auth family is
 * excluded from codegen, which is the rule the composition exists to keep.
 */

const REST = "http://rest.test:4000";

/** What `get-session` answers for somebody signed in. */
const SIGNED_IN = {
  session: { activeOrganizationId: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10" },
  user: {
    id: "5eed0003-0000-4000-8000-000000000001",
    email: "ken@acme-robotics.dev",
    name: "Ken Suenobu",
    image: null,
    createdAt: "2026-08-11T10:20:23.114Z",
    updatedAt: "2026-08-11T10:20:23.114Z",
  },
};

/** One organization, as `organization/list` returns it — note the absent role. */
const ACME = {
  id: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
  name: "Acme, Inc.",
  slug: "acme",
};

/** What each route answers, and the requests that were made. */
interface Stub {
  readonly urls: string[];
  readonly headers: (HeadersInit | undefined)[];
}

/**
 * Answer the three auth routes.
 *
 * @param answers Body and status per route, keyed by the path fragment that identifies it.
 * @returns What was asked, in order.
 */
function serviceAnswering(answers: {
  session?: { body: unknown; status?: number };
  list?: { body: unknown; status?: number };
  role?: { body: unknown; status?: number };
}): Stub {
  const urls: string[] = [];
  const headers: (HeadersInit | undefined)[] = [];

  const pick = (url: string) => {
    if (url.includes("/get-session")) return answers.session ?? { body: SIGNED_IN };
    if (url.includes("/organization/list")) return answers.list ?? { body: [] };
    return answers.role ?? { body: { role: "owner" } };
  };

  vi.stubGlobal("fetch", (input: string, init?: RequestInit) => {
    urls.push(input);
    headers.push(init?.headers);

    const { body, status = 200 } = pick(input);
    return Promise.resolve(
      new Response(body === null ? "null" : JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  return { urls, headers };
}

describe("session.read", () => {
  beforeEach(() => {
    jar.clear();
    resetRestUrlCache();
    process.env.OURO_REST_URL = REST;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OURO_REST_URL;
    resetRestUrlCache();
  });

  it("asks the three routes the contract publishes for the question", async () => {
    // The acceptance criterion of #711, from the consumer's side: who you are, where you
    // belong, and what you hold there. A fourth call to anything under `/api/v1` would be
    // the duplicate the issue exists to prevent.
    const stub = serviceAnswering({ list: { body: [ACME] } });

    await session.read();

    expect(stub.urls).toEqual([
      `${REST}/api/auth/get-session`,
      `${REST}/api/auth/organization/list`,
      `${REST}/api/auth/organization/get-active-member-role?organizationId=${ACME.id}`,
    ]);
  });

  it("reaches nothing under the versioned API", async () => {
    const stub = serviceAnswering({ list: { body: [ACME] } });

    await session.read();

    for (const url of stub.urls) {
      expect(url).not.toContain("/api/v1/");
    }
  });

  it("forwards both of BetterAuth's cookies, not just the token", async () => {
    // The second is the signed five-minute snapshot the service answers a session from
    // without a database lookup. Dropping it is not a failure — it is every call costing a
    // query — which is exactly the kind of regression nothing else would notice.
    jar.set("better-auth.session_token", "token-value");
    jar.set("better-auth.session_data", "cached-snapshot");
    const stub = serviceAnswering({});

    await session.read();

    expect((stub.headers[0] as Record<string, string>).Cookie).toBe(
      "better-auth.session_token=token-value; better-auth.session_data=cached-snapshot",
    );
  });

  it("forwards no cookie header at all when the browser sent neither", async () => {
    const stub = serviceAnswering({});

    await session.read();

    expect((stub.headers[0] as Record<string, string>).Cookie).toBeUndefined();
  });

  it("sends nothing of this application's own cookies", async () => {
    // A cookie the service has no use for is one forwarded to a service that might log it.
    jar.set("better-auth.session_token", "token-value");
    jar.set("ouro_tenant", "acme");
    const stub = serviceAnswering({});

    await session.read();

    expect((stub.headers[0] as Record<string, string>).Cookie).toBe(
      "better-auth.session_token=token-value",
    );
  });

  it("translates the library's vocabulary into this application's", async () => {
    // `name` and `image` are BetterAuth's field names; every screen here reads
    // `displayName` and `avatarUrl`. The translation happens once, in one place.
    serviceAnswering({});

    const read = await session.read();

    expect(read?.user).toEqual({
      id: SIGNED_IN.user.id,
      email: SIGNED_IN.user.email,
      displayName: "Ken Suenobu",
      avatarUrl: null,
      createdAt: SIGNED_IN.user.createdAt,
      updatedAt: SIGNED_IN.user.updatedAt,
    });
  });

  it("carries an avatar through when the provider knows one", async () => {
    serviceAnswering({
      session: { body: { ...SIGNED_IN, user: { ...SIGNED_IN.user, image: "https://a.test/k" } } },
    });

    expect((await session.read())?.user.avatarUrl).toBe("https://a.test/k");
  });

  it("joins each organization to the role held in it", async () => {
    // The listing carries no role — the plugin's adapter discards it — so the join is this
    // module's work and is the reason the third call exists at all.
    serviceAnswering({ list: { body: [ACME] }, role: { body: { role: "admin" } } });

    expect((await session.read())?.memberships).toEqual([
      {
        tenantId: ACME.id,
        slug: "acme",
        displayName: "Acme, Inc.",
        status: "active",
        role: "admin",
      },
    ]);
  });

  it("degrades an unreadable role to the least this API grants", async () => {
    // A screen that guessed high would render a control the service then refuses.
    serviceAnswering({ list: { body: [ACME] }, role: { body: null } });

    expect((await session.read())?.memberships[0].role).toBe("viewer");
  });

  it("returns the memberships as a list, empty rather than absent", async () => {
    serviceAnswering({ list: { body: [] } });

    expect((await session.read())?.memberships).toEqual([]);
  });

  it("answers null for nobody, rather than throwing", async () => {
    // What replaced the `401` the deleted route answered. The absence of a session is the
    // answer a login screen is asking for, so `get-session` says `null` and this passes it
    // on — which is why `app/api/access.ts` no longer catches anything.
    serviceAnswering({ session: { body: null } });

    expect(await session.read()).toBeNull();
  });

  it("asks nothing further once there is nobody to ask about", async () => {
    const stub = serviceAnswering({ session: { body: null } });

    await session.read();

    expect(stub.urls).toEqual([`${REST}/api/auth/get-session`]);
  });

  it("reports a suggestion of null until #712 supplies one", async () => {
    // The third part of the deleted route's answer, and the one with no BetterAuth
    // equivalent: it is about this installation's tenant domains rather than about a
    // session. `POST /api/v1/auth/discover` is where it moves.
    serviceAnswering({});

    expect((await session.read())?.tenantSuggestion).toBeNull();
  });

  it("rejects with the library's error shape when a call is refused", async () => {
    // Not `ApiError`: these routes are BetterAuth's and compose their own failures. A
    // caller handling both families handles two error shapes, and that is a real cost of
    // the two-client rule rather than something to paper over.
    serviceAnswering({
      session: { body: { code: "INTERNAL_SERVER_ERROR", message: "no" }, status: 500 },
    });

    const caught: unknown = await session.read().catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(AuthError);
    expect((caught as AuthError).status).toBe(500);
    expect((caught as AuthError).code).toBe("INTERNAL_SERVER_ERROR");
    expect((caught as AuthError).path).toBe("/api/auth/get-session");
  });

  it("does not read a refusal of the session route as being signed out", async () => {
    // `null` means *nobody*; a `401` means *refused*, which is a different fact. Reading
    // the second as the first would render a login screen for a service that is failing.
    serviceAnswering({ session: { body: { message: "no" }, status: 401 } });

    await expect(session.read()).rejects.toBeInstanceOf(AuthError);
  });
});
