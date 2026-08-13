import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthError } from "@/app/api/auth-client";
import { resetRestUrlCache } from "@/app/env";
import { LOGIN_PATH } from "@/app/paths";

import { requestedUrl } from "../helpers/auth";

/**
 * The auth family, called from the server — what
 * [#716](https://github.com/NobuData/ouroboros/issues/716) replaced `app/api/session.ts`
 * with.
 *
 * The questions are the ones that suite asked, because the *behaviour* is meant to be
 * unchanged: which routes answer "who is signed in", that BetterAuth's two cookies reach
 * them, and that the library's vocabulary arrives as this application's. What is new is
 * everything the stand-in could not do — the org actions, signing out, and a `401` that
 * routes to the login screen rather than reaching the caller as an error.
 *
 * The generated client is not involved and must not be: the auth family is excluded from
 * codegen, which is the rule the composition exists to keep.
 */

// The module sits behind `server-only` and reads the request's cookies, so both are answered
// here — the jar below is the request under test.
vi.mock("server-only", () => ({}));

/** The cookies of the request under test. */
const jar = new Map<string, string>();
/** Cookies deleted while serving it. */
const deleted: string[] = [];

vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
      set: () => {},
      delete: (name: string) => {
        deleted.push(name);
        jar.delete(name);
      },
    }),
}));

/** Where the request was sent, if it was. */
let redirectedTo: string | undefined;

/** What Next.js's `redirect` throws, so that nothing after a redirect runs. */
class RedirectSignal extends Error {}

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    redirectedTo = path;
    throw new RedirectSignal(path);
  },
}));

const { readSession, setActiveOrganization, signOutSession } = await import(
  "@/app/api/auth-server"
);
const { resetApiClient } = await import("@/app/api/server");

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

/**
 * One workspace, as `GET /api/v1/orgs` returns it — roles, counts and all.
 *
 * The listing this module reads memberships from since
 * [#719](https://github.com/NobuData/ouroboros/issues/719). It used to be
 * `organization/list`, which answers three fields and *no role*, and the role was a further
 * call per workspace; the row model carries everything a workspace switcher and mockup 01
 * Step 2 need, so there is one call and no join.
 */
const ACME = {
  id: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
  slug: "acme",
  name: "Acme, Inc.",
  monogram: "AI",
  personal: false,
  roles: ["admin"],
  enabled: true,
  repoCounts: { enabled: 4, total: 4 },
  featuredRepo: "helios-firmware",
  githubOrgs: [{ login: "acme", enabled: true, repoCounts: { enabled: 4, total: 4 } }],
  createdAt: "2026-08-11T10:20:23.114Z",
};

/** One page of the listing, around whichever rows a case is about. */
function page(items: unknown[], total = items.length) {
  return { items, total, limit: 100, offset: 0 };
}

/** What each route answered, and what was asked of it. */
interface Stub {
  readonly urls: string[];
  readonly headers: Headers[];
  readonly methods: (string | undefined)[];
  readonly bodies: (string | undefined)[];
}

/** Body and status for one route. */
interface Answer {
  body: unknown;
  status?: number;
}

/**
 * Answer the auth routes.
 *
 * @param answers Body and status per route, keyed by the path fragment that identifies it.
 * @returns What was asked, in order.
 */
function serviceAnswering(answers: {
  session?: Answer;
  orgs?: Answer;
  setActive?: Answer;
  signOut?: Answer;
}): Stub {
  const urls: string[] = [];
  const headers: Headers[] = [];
  const methods: (string | undefined)[] = [];
  const bodies: (string | undefined)[] = [];

  const pick = (url: string): Answer => {
    if (url.includes("/get-session")) return answers.session ?? { body: SIGNED_IN };
    if (url.includes("/api/v1/orgs")) return answers.orgs ?? { body: page([]) };
    if (url.includes("/organization/set-active")) return answers.setActive ?? { body: ACME };
    if (url.includes("/sign-out")) return answers.signOut ?? { body: { success: true } };
    return { body: {} };
  };

  // Two clients reach this stub and they hand `fetch` different things: BetterAuth's passes
  // a `URL` and an init, the generated one passes a composed `Request`. Reading both is what
  // lets one stub answer the two families a session is now composed from.
  vi.stubGlobal("fetch", (input: Request | URL | string, init?: RequestInit) => {
    const url = requestedUrl(input);
    const composed = input instanceof Request ? input : undefined;
    urls.push(url);
    headers.push(new Headers(composed?.headers ?? init?.headers));
    methods.push(composed?.method ?? init?.method);
    bodies.push(typeof init?.body === "string" ? init.body : undefined);

    const { body, status = 200 } = pick(url);
    return Promise.resolve(
      new Response(body === null ? "null" : JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  return { urls, headers, methods, bodies };
}

beforeEach(() => {
  jar.clear();
  deleted.length = 0;
  redirectedTo = undefined;
  resetRestUrlCache();
  resetApiClient();
  process.env.OURO_REST_URL = REST;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.OURO_REST_URL;
  resetRestUrlCache();
  resetApiClient();
});

describe("readSession", () => {
  it("asks two routes — who you are, and where you belong", async () => {
    // #711's acceptance criterion, as #719 leaves it. It was three calls and one of them
    // was *per workspace*, because `organization/list` discards the role; the row model
    // carries roles and counts together, so the fan-out is gone.
    const stub = serviceAnswering({ orgs: { body: page([ACME]) } });

    await readSession();

    expect(stub.urls).toEqual([
      `${REST}/api/auth/get-session`,
      `${REST}/api/v1/orgs?limit=100`,
    ]);
  });

  it("costs the same two calls however many workspaces there are", async () => {
    // The property the fan-out did not have, and the reason for the move: a person in
    // twenty workspaces used to cost twenty-two requests to render a login screen.
    const stub = serviceAnswering({
      orgs: { body: page([ACME, { ...ACME, id: "b", slug: "b" }, { ...ACME, id: "c", slug: "c" }]) },
    });

    await readSession();

    expect(stub.urls).toHaveLength(2);
  });

  it("reaches the auth family for the session and the generated one for the rows", async () => {
    // The two-client rule, from the one module that spans it: auth routes through the auth
    // client, everything else through the generated one. A workspace listing composed out
    // of `/api/auth` calls is what this replaced.
    const stub = serviceAnswering({ orgs: { body: page([ACME]) } });

    await readSession();

    expect(stub.urls[0]).toContain("/api/auth/");
    expect(stub.urls[1]).toContain("/api/v1/");
  });

  it("asks for the contract's maximum page, so a switcher is not silently truncated", async () => {
    const stub = serviceAnswering({ orgs: { body: page([ACME]) } });

    await readSession();

    expect(new URL(stub.urls[1]).searchParams.get("limit")).toBe("100");
  });

  it("addresses the service rather than this origin", async () => {
    // The browser's copy of the same client calls `/api/auth` on this origin and lets
    // `proxy.ts` forward it. On the server there is no proxy in the way and no reason for
    // one: `OURO_REST_URL` is right here.
    const stub = serviceAnswering({});

    await readSession();

    expect(new URL(stub.urls[0]).origin).toBe(REST);
  });

  it("forwards both of BetterAuth's cookies, not just the token", async () => {
    // The second is the signed five-minute snapshot the service answers a session from
    // without a database lookup. Dropping it is not a failure — it is every call costing a
    // query — which is exactly the kind of regression nothing else would notice.
    jar.set("better-auth.session_token", "token-value");
    jar.set("better-auth.session_data", "cached-snapshot");
    const stub = serviceAnswering({});

    await readSession();

    expect(stub.headers[0].get("cookie")).toBe(
      "better-auth.session_token=token-value; better-auth.session_data=cached-snapshot",
    );
  });

  it("forwards no cookie header at all when the browser sent neither", async () => {
    const stub = serviceAnswering({});

    await readSession();

    expect(stub.headers[0].get("cookie")).toBeNull();
  });

  it("sends nothing of this application's own cookies", async () => {
    // A cookie the service has no use for is one forwarded to a service that might log it.
    jar.set("better-auth.session_token", "token-value");
    jar.set("ouro_tenant", "acme");
    const stub = serviceAnswering({});

    await readSession();

    expect(stub.headers[0].get("cookie")).toBe("better-auth.session_token=token-value");
  });

  it("translates the library's vocabulary into this application's", async () => {
    // `name` and `image` are BetterAuth's field names; every screen here reads
    // `displayName` and `avatarUrl`. The translation happens once, in one place.
    serviceAnswering({});

    const read = await readSession();

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

    expect((await readSession())?.user.avatarUrl).toBe("https://a.test/k");
  });

  it("carries the service's rows through unchanged, field for field", async () => {
    // A *grouping* rather than a second contract: the row model is what mockup 01 Step 2 is
    // drawn from, so a field reshaped on the way through here would be a field the screen
    // and the service disagree about.
    serviceAnswering({ orgs: { body: page([ACME]) } });

    expect((await readSession())?.memberships).toEqual([ACME]);
  });

  it("keeps a `viewer`, which the auth client's own types have no name for", async () => {
    // `ouroboros-rest` configures a fourth role the organization plugin's default typing
    // does not know about. It arrives through the *generated* client now, typed from the
    // contract that publishes all four, so there is nothing left to widen.
    serviceAnswering({ orgs: { body: page([{ ...ACME, roles: ["viewer"] }]) } });

    expect((await readSession())?.memberships[0].roles).toEqual(["viewer"]);
  });

  it("carries an empty role list rather than inventing one", async () => {
    // The contract admits it: "possibly none, for a membership carrying only roles this
    // service does not recognise". `mayAdminister` is what refuses such a row a switch.
    serviceAnswering({ orgs: { body: page([{ ...ACME, roles: [] }]) } });

    expect((await readSession())?.memberships[0].roles).toEqual([]);
  });

  it("reports where the session is acting", async () => {
    // The tenancy authority since #719, and the reason this field is carried at all:
    // `app/api/access.ts` resolves it against the memberships beside it.
    serviceAnswering({ orgs: { body: page([ACME]) } });

    expect((await readSession())?.activeOrganizationId).toBe(ACME.id);
  });

  it("reports a session acting nowhere as null rather than as absent", async () => {
    serviceAnswering({
      session: { body: { ...SIGNED_IN, session: { activeOrganizationId: null } } },
    });

    expect((await readSession())?.activeOrganizationId).toBeNull();
  });

  it("carries the listing's own total, so a screen can say what it left out", async () => {
    serviceAnswering({ orgs: { body: page([ACME], 340) } });

    const read = await readSession();

    expect(read?.memberships).toHaveLength(1);
    expect(read?.membershipTotal).toBe(340);
  });

  it("returns the memberships as a list, empty rather than absent", async () => {
    serviceAnswering({ orgs: { body: page([]) } });

    expect((await readSession())?.memberships).toEqual([]);
  });

  it("lets the listing's own failure reject as an ApiError", async () => {
    // The other family's error shape, reaching a caller that also handles BetterAuth's.
    // That is the real cost of the two-client rule rather than something to paper over —
    // and a `401` here is deliberately *not* a redirect, because the screen most likely to
    // be rendering is the login screen itself.
    serviceAnswering({
      orgs: { body: { code: "internal_error", message: "no", details: {} }, status: 500 },
    });

    await expect(readSession()).rejects.toMatchObject({ name: "ApiError", status: 500 });
  });

  it("answers null for nobody, rather than throwing", async () => {
    // What replaced the `401` the deleted route answered. The absence of a session is the
    // answer a login screen is asking for, so `get-session` says `null` and this passes it
    // on — which is why `app/api/access.ts` no longer catches anything.
    serviceAnswering({ session: { body: null } });

    expect(await readSession()).toBeNull();
  });

  it("asks nothing further once there is nobody to ask about", async () => {
    // Including the workspace listing: it is scoped to the caller, and there is no caller.
    const stub = serviceAnswering({ session: { body: null } });

    await readSession();

    expect(stub.urls).toEqual([`${REST}/api/auth/get-session`]);
  });

  it("reports a suggestion of null until #712 supplies one", async () => {
    // The third part of the deleted route's answer, and the one with no BetterAuth
    // equivalent: it is about this installation's tenant domains rather than about a
    // session. `POST /api/v1/auth/discover` is where it moves.
    serviceAnswering({});

    expect((await readSession())?.tenantSuggestion).toBeNull();
  });

  it("rejects with the library's error shape when a call is refused", async () => {
    // Not `ApiError`: these routes are BetterAuth's and compose their own failures. A
    // caller handling both families handles two error shapes, and that is a real cost of
    // the two-client rule rather than something to paper over.
    serviceAnswering({
      session: { body: { code: "INTERNAL_SERVER_ERROR", message: "no" }, status: 500 },
    });

    const caught: unknown = await readSession().catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(AuthError);
    expect((caught as AuthError).status).toBe(500);
    expect((caught as AuthError).code).toBe("INTERNAL_SERVER_ERROR");
    expect((caught as AuthError).path).toBe("/api/auth/get-session");
  });

  it("sends a refused request to the login screen rather than to its caller", async () => {
    // #716's `401` rule, server side. `null` means *nobody* and is an answer; a `401` means
    // the request itself was refused, which on these routes means the cookie no longer opens
    // anything — so the screen to render is the one that gets a new session.
    serviceAnswering({ session: { body: { message: "no" }, status: 401 } });

    await expect(readSession()).rejects.toThrow(RedirectSignal);
    expect(redirectedTo).toBe(LOGIN_PATH);
  });

  it("carries no return-to, because a Server Component cannot read the URL it renders for", async () => {
    // The parameter is filled in by the browser, which knows exactly where it was, and by
    // the login route, which honours whatever arrives. Giving the server the same knowledge
    // is the middleware decision #720 owns.
    serviceAnswering({ session: { body: null, status: 401 } });

    await readSession().catch(() => undefined);

    expect(redirectedTo).not.toContain("?");
  });
});

describe("setActiveOrganization", () => {
  it("posts the workspace to the plugin's own route", async () => {
    const stub = serviceAnswering({});

    await setActiveOrganization(ACME.id);

    expect(stub.urls).toEqual([`${REST}/api/auth/organization/set-active`]);
    expect(stub.methods[0]).toBe("POST");
    expect(JSON.parse(stub.bodies[0] ?? "{}")).toEqual({ organizationId: ACME.id });
  });

  it("carries this request's cookies, since the service decides who may switch", async () => {
    jar.set("better-auth.session_token", "token-value");
    const stub = serviceAnswering({});

    await setActiveOrganization(ACME.id);

    expect(stub.headers[0].get("cookie")).toBe("better-auth.session_token=token-value");
  });

  it("lets a refusal reach the caller, because it is the membership check", async () => {
    // A `403` here means the caller does not belong to the workspace they named. Swallowing
    // it would leave a screen showing a workspace the session is not actually acting in.
    serviceAnswering({ setActive: { body: { code: "FORBIDDEN", message: "no" }, status: 403 } });

    await expect(setActiveOrganization("somebody-elses")).rejects.toBeInstanceOf(AuthError);
  });
});

describe("signOutSession", () => {
  it("ends the session on the service, not only in this browser", async () => {
    // A session that is merely forgotten by the browser is a session a copied cookie still
    // opens. `sign-out` is what deletes the row.
    jar.set("better-auth.session_token", "token-value");
    const stub = serviceAnswering({});

    await signOutSession().catch(() => undefined);

    expect(stub.urls).toEqual([`${REST}/api/auth/sign-out`]);
    expect(stub.methods[0]).toBe("POST");
  });

  it("clears both auth cookies and the step-2 hint", async () => {
    // The service's own `Set-Cookie` arrives *here* rather than at the browser, because this
    // call is made by the server — so the deletion has to be made on the response being
    // composed. `ouro_tenant` is this application's own and nothing else would clear it.
    jar.set("better-auth.session_token", "token-value");
    jar.set("better-auth.session_data", "cached-snapshot");
    jar.set("ouro_tenant", "acme-robotics");
    serviceAnswering({});

    await signOutSession().catch(() => undefined);

    expect(deleted).toEqual([
      "better-auth.session_token",
      "better-auth.session_data",
      "ouro_tenant",
    ]);
  });

  it("lands on the login screen", async () => {
    serviceAnswering({});

    await expect(signOutSession()).rejects.toThrow(RedirectSignal);
    expect(redirectedTo).toBe(LOGIN_PATH);
  });

  it("signs out of this browser even when the service refused", async () => {
    // An expired session answers `401` to its own sign-out. Leaving the cookies in place
    // because of it would be a person who pressed *sign out* and stayed signed in.
    jar.set("better-auth.session_token", "token-value");
    serviceAnswering({ signOut: { body: { message: "no" }, status: 401 } });

    await signOutSession().catch(() => undefined);

    expect(deleted).toContain("better-auth.session_token");
    expect(redirectedTo).toBe(LOGIN_PATH);
  });
});
