import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AUTH_BASE_PATH,
  AUTH_COOKIES,
  AuthError,
  asRole,
  authClient,
  isoTimestamp,
  unauthenticatedDestination,
  unwrap,
  useSession,
} from "@/app/api/auth-client";
import { SESSION_COOKIES } from "@/app/api/client";
import { ROLES } from "@/app/api/membership";
import { LOGIN_PATH, RETURN_TO_PARAM } from "@/app/paths";
import { config as proxyConfig } from "@/proxy";

import { requestedUrl } from "../helpers/auth";

/**
 * BetterAuth's client, as this module configures it
 * ([#716](https://github.com/NobuData/ouroboros/issues/716)).
 *
 * Three things are worth a suite and the rest is the library's own business. **That the
 * organization plugin is installed** — without it `organization.list` is a path this client
 * has never heard of, and the failure is a `404` at runtime rather than a compile error.
 * **That the browser's copy addresses this origin** and not the service, which is the whole
 * of why `OURO_REST_URL` carries no `NEXT_PUBLIC_` prefix. And **the translations**, which
 * are where the library's vocabulary and this application's meet — including the role widening
 * that exists because the client's types know three roles and the service serves four.
 *
 * What is *not* asserted is the transport: better-fetch composes the request, and a suite
 * that re-stated its rules would be testing the dependency. What is asserted is every place
 * this module made a decision.
 */

/**
 * Nothing in this file may reach a socket, and one thing here outlives its case.
 *
 * The session store behind `useSession()` is shared for the life of the module and keeps
 * refreshing after the component that woke it has been unmounted — that is the point of it,
 * and it is why a tab does not ask twice. Restoring the runtime's own `fetch` between cases
 * would let one of those refreshes out onto the network, where it reaches for whatever is
 * listening on port 3000. Assigning the safe default *before* any `vi.stubGlobal` call makes
 * it the value `unstubAllGlobals` restores, so every per-case stub is layered over this one
 * rather than over the real implementation.
 */
globalThis.fetch = (() => Promise.resolve(answering(null))) as typeof fetch;

/** A response the client will parse. */
function answering(body: unknown, status = 200): Response {
  return new Response(body === null ? "null" : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("what the client addresses", () => {
  it("mounts on the prefix `ouroboros-rest` serves BetterAuth from", () => {
    expect(AUTH_BASE_PATH).toBe("/api/auth");
  });

  it("agrees with the proxy that forwards that prefix", () => {
    // `proxy.ts` writes the string out again — a matcher is read statically at build time, so
    // it cannot import a constant. This is the check that keeps the two copies one string:
    // change the prefix in one place and the browser's calls stop being forwarded at all.
    //
    // `toContain` rather than `toBe` since
    // [#720](https://github.com/NobuData/ouroboros/issues/720): the matcher is a list now,
    // because that file also stamps every page request with its own address. What this holds
    // is the forwarder's entry; `__tests__/proxy.test.ts` holds the rest of the list.
    expect(proxyConfig.matcher).toContain(`${AUTH_BASE_PATH}/:path*`);
  });

  it("names the same session cookies as the generated client", () => {
    // Two families, two clients, one pair of cookies. `app/api/client.ts` declares its own
    // copy deliberately — neither may import the other — so this is what holds them equal.
    expect([...AUTH_COOKIES]).toEqual([...SESSION_COOKIES]);
  });

  it("does not carry the service's address into the browser's bundle", () => {
    // `OURO_REST_URL` is server-side configuration. If this module ever read it, a Client
    // Component importing the client would ship the service's address to every visitor.
    const source = authClient.getSession.toString();

    expect(source).not.toContain("OURO_REST_URL");
    expect(process.env.NEXT_PUBLIC_OURO_REST_URL).toBeUndefined();
  });
});

describe("the organization plugin", () => {
  let urls: string[];
  let methods: (string | undefined)[];

  beforeEach(() => {
    urls = [];
    methods = [];

    vi.stubGlobal("fetch", (input: Request | URL | string, init?: RequestInit) => {
      urls.push(requestedUrl(input));
      methods.push(init?.method);
      return Promise.resolve(answering([]));
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("answers `organization.list` on the plugin's own route", async () => {
    await authClient.organization.list();

    expect(new URL(urls[0]).pathname).toBe(`${AUTH_BASE_PATH}/organization/list`);
  });

  it("puts a workspace id in the query for the role call", async () => {
    await authClient.organization.getActiveMemberRole({
      query: { organizationId: "5eed0001-0000-4000-8000-000000000001" },
    });

    const asked = new URL(urls[0]);

    expect(asked.pathname).toBe(`${AUTH_BASE_PATH}/organization/get-active-member-role`);
    expect(asked.searchParams.get("organizationId")).toBe(
      "5eed0001-0000-4000-8000-000000000001",
    );
  });

  it("escapes a workspace id rather than pasting it into the query", async () => {
    await authClient.organization.getFullOrganization({
      query: { organizationId: "a workspace/with?punctuation" },
    });

    expect(urls[0]).toContain("organizationId=a%20workspace%2Fwith%3Fpunctuation");
  });

  it("posts `setActive`, because it is a write", async () => {
    await authClient.organization.setActive({ organizationId: "acme" });

    expect(new URL(urls[0]).pathname).toBe(`${AUTH_BASE_PATH}/organization/set-active`);
    expect(methods[0]).toBe("POST");
  });

  it("posts `signOut`", async () => {
    await authClient.signOut();

    expect(new URL(urls[0]).pathname).toBe(`${AUTH_BASE_PATH}/sign-out`);
    expect(methods[0]).toBe("POST");
  });

  it("resolves the fetch implementation per call, so a suite can answer without a socket", async () => {
    // The client is built once, at import. Had it captured `fetch` then, every stub a suite
    // installs afterwards would be answering nobody — including the three above.
    await authClient.organization.list();

    expect(urls).toHaveLength(1);
  });
});

describe("unwrap", () => {
  it("hands back the body when there was no refusal", () => {
    expect(unwrap({ data: { id: "acme" }, error: null }, "/organization/list")).toEqual({
      id: "acme",
    });
  });

  it("passes `null` through, because it is an answer rather than an absence", () => {
    // `get-session` replies `null` for nobody signed in, and `get-active-member-role` for a
    // workspace the caller holds nothing in. Both are facts a screen renders.
    expect(unwrap({ data: null, error: null }, "/get-session")).toBeNull();
  });

  it("throws the library's failure, named by route", () => {
    const caught: unknown = (() => {
      try {
        unwrap(
          { data: null, error: { status: 500, code: "INTERNAL_SERVER_ERROR", message: "no" } },
          "/get-session",
        );
      } catch (error: unknown) {
        return error;
      }
    })();

    expect(caught).toBeInstanceOf(AuthError);
    expect((caught as AuthError).status).toBe(500);
    expect((caught as AuthError).code).toBe("INTERNAL_SERVER_ERROR");
    expect((caught as AuthError).message).toBe("no");
    expect((caught as AuthError).path).toBe("/api/auth/get-session");
  });

  it("reports a request that never got an answer as status zero", () => {
    // A network failure is reported in the value like everything else, with no status in it.
    // Zero rather than a guess: "the service said no" and "nothing answered" are different.
    try {
      unwrap({ data: null, error: { message: "Failed to fetch" } }, "/get-session");
      expect.unreachable("should have thrown");
    } catch (error: unknown) {
      expect((error as AuthError).status).toBe(0);
    }
  });

  it("composes a message when the failure carried none", () => {
    try {
      unwrap({ data: null, error: { status: 502 } }, "/organization/list");
      expect.unreachable("should have thrown");
    } catch (error: unknown) {
      expect((error as AuthError).message).toContain("/api/auth/organization/list");
      expect((error as AuthError).message).toContain("502");
    }
  });
});

describe("asRole", () => {
  it("keeps every role the contract publishes", () => {
    for (const role of ROLES) {
      expect(asRole(role)).toBe(role);
    }
  });

  it("keeps `viewer`, which the client's own types do not know about", () => {
    // The reason this function exists. `ouroboros-rest` configures a fourth role
    // (`src/auth/organization.roles.ts`) that the plugin's default typing has no name for, so
    // a client that trusted its types would drop the one role most people hold.
    expect(asRole("viewer")).toBe("viewer");
  });

  it("degrades an unknown role to the least this API grants", () => {
    // A screen that guessed high would render a control the service then refuses.
    expect(asRole("superuser")).toBe("viewer");
  });

  it("degrades a role nobody reported at all", () => {
    expect(asRole(undefined)).toBe("viewer");
  });
});

describe("isoTimestamp", () => {
  it("passes an ISO string through, which is what the wire actually carries", () => {
    expect(isoTimestamp("2026-08-11T10:20:23.114Z")).toBe("2026-08-11T10:20:23.114Z");
  });

  it("renders a Date, which is what the client's types promise", () => {
    expect(isoTimestamp(new Date("2026-08-11T10:20:23.114Z"))).toBe(
      "2026-08-11T10:20:23.114Z",
    );
  });
});

describe("where a refused request sends the browser", () => {
  it("routes a 401 to the login screen, remembering where it was", () => {
    expect(unauthenticatedDestination(401, "/dashboard")).toBe(
      `${LOGIN_PATH}?${RETURN_TO_PARAM}=%2Fdashboard`,
    );
  });

  it("keeps the query string, so the request being resumed is the one that was made", () => {
    const destination = unauthenticatedDestination(401, "/dashboard?tab=runs");

    expect(new URL(destination ?? "", "http://ui.test").searchParams.get(RETURN_TO_PARAM)).toBe(
      "/dashboard?tab=runs",
    );
  });

  it("stays put on the login screen, which would otherwise be a reload per refusal", () => {
    // A `401` here is the screen's own answer — a sign-in that was refused — and the card is
    // about to say so.
    expect(unauthenticatedDestination(401, LOGIN_PATH)).toBeUndefined();
    expect(unauthenticatedDestination(401, `${LOGIN_PATH}?workspace=acme`)).toBeUndefined();
  });

  it("stays put for anything that is not a 401", () => {
    // These routes answer `null` for *no session*, so every other status is a refusal to
    // report rather than a session to renew.
    expect(unauthenticatedDestination(403, "/dashboard")).toBeUndefined();
    expect(unauthenticatedDestination(500, "/dashboard")).toBeUndefined();
    expect(unauthenticatedDestination(200, "/dashboard")).toBeUndefined();
  });
});

/**
 * The session, as a Client Component reads it.
 *
 * #716's first acceptance criterion, exercised the way it will actually be used: a component
 * marked `"use client"` calls `useSession()` and renders what comes back. The account menu
 * ([#721](https://github.com/NobuData/ouroboros/issues/721)) is the case this is here for —
 * everything on `/login` is Server Components and reads through `app/api/auth-server.ts`
 * instead.
 */
describe("useSession, in a client component", () => {
  /** What `get-session` answers for somebody signed in. */
  const SIGNED_IN = {
    session: { activeOrganizationId: "5eed0001-0000-4000-8000-000000000001" },
    user: {
      id: "5eed0003-0000-4000-8000-000000000001",
      email: "ken@acme-robotics.dev",
      name: "Ken Suenobu",
      image: null,
    },
  };

  /** The component under test — the shape a header's account menu takes. */
  function AccountName() {
    const { data, isPending } = useSession();

    if (isPending) return <p>reading…</p>;

    return <p>{data === null ? "signed out" : data.user.name}</p>;
  }

  /**
   * Render the component against one answer, and wait for it to have read.
   *
   * **The session store is shared for the life of the module**, which is the point of it: two
   * components asking at once make one request, and a sign-out anywhere in the tab reaches
   * every one of them. A suite pays for that by having to invalidate it between cases —
   * `$sessionSignal` is the library's own way of saying *this is stale*, and is what the
   * client notifies itself after a sign-in or a sign-out.
   *
   * @param answer What `get-session` replies with.
   * @returns The URLs the component asked for, in order.
   */
  async function renderAccountName(answer: unknown): Promise<string[]> {
    const urls: string[] = [];
    vi.stubGlobal("fetch", (input: Request | URL | string) => {
      urls.push(requestedUrl(input));
      return Promise.resolve(answering(answer));
    });

    render(<AccountName />);
    authClient.$store.notify("$sessionSignal");

    await waitFor(() => {
      expect(urls.length).toBeGreaterThan(0);
      expect(screen.queryByText("reading…")).not.toBeInTheDocument();
    });

    return urls;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("names the signed-in person once the read lands", async () => {
    await renderAccountName(SIGNED_IN);

    await waitFor(() => {
      expect(screen.getByText("Ken Suenobu")).toBeInTheDocument();
    });
  });

  it("reads a session over this origin, never over the service's address", async () => {
    // The property that makes a Client Component safe to write at all: the browser calls
    // `/api/auth/get-session` here, and `proxy.ts` is what forwards it.
    const urls = await renderAccountName(SIGNED_IN);

    expect(new URL(urls[0]).origin).toBe(window.location.origin);
    expect(new URL(urls[0]).pathname).toBe(`${AUTH_BASE_PATH}/get-session`);
  });

  it("reports nobody rather than failing, because that is what the route answers", async () => {
    await renderAccountName(null);

    await waitFor(() => {
      expect(screen.getByText("signed out")).toBeInTheDocument();
    });
  });
});
