import { NextRequest } from "next/server";
import type { NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AUTH_BASE_PATH } from "@/app/api/auth-client";
import { REQUEST_PATH_HEADER } from "@/app/api/request";
import { REST_URL_VAR, resetRestUrlCache } from "@/app/env";
import { config, proxy, requestAddress } from "@/proxy";

/**
 * `proxy.ts` — the two things this origin does before Next.js sees a request.
 *
 * The forwarder is [#716](https://github.com/NobuData/ouroboros/issues/716)'s and is
 * asserted here for the first time: `__tests__/api/auth-client.test.tsx` held the matcher
 * against `AUTH_BASE_PATH` and nothing held the rewrite. The stamper is
 * [#720](https://github.com/NobuData/ouroboros/issues/720)'s, and is the half with decisions
 * in it — which requests it runs on, what a return-to may contain, and that a caller cannot
 * choose the value.
 *
 * **What is deliberately *not* here is an authorization case, because there is no
 * authorization in this file.** That is the middleware decision this issue records, and
 * `proxy.ts` § *Why this file is not the auth gate* is where it is argued;
 * `__tests__/api/access.test.ts` is where the one gate is held. A case here asserting that
 * proxy lets a signed-out request through would be asserting the absence of a feature, which
 * is what the last describe block below does once, by name, rather than everywhere.
 */

/** The service the forwarder rewrites onto. */
const REST = "http://rest.test:4000";

/**
 * One request to this origin.
 *
 * @param path The path and query, as a browser would send it.
 * @param headers Anything the caller sent — used by the case about a forged one.
 * @returns The request, as Next.js would hand it to {@link proxy}.
 */
function request(path: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3000"), { headers });
}

/**
 * The request header {@link proxy} added, read out of the response it returned.
 *
 * A proxy cannot hand its caller a request, so Next.js carries modified request headers back
 * on the response under `x-middleware-request-*`, with `x-middleware-override-headers`
 * listing the names — the wire format `NextResponse.next({request: {headers}})` produces and
 * the server reads back into `headers()`. Decoding it here is what lets this suite assert the
 * value without a running framework.
 *
 * @param response What {@link proxy} returned.
 * @returns The stamped address, or `undefined` when nothing was stamped.
 */
function stamped(response: NextResponse): string | undefined {
  return response.headers.get(`x-middleware-request-${REQUEST_PATH_HEADER}`) ?? undefined;
}

/**
 * Which paths a matcher entry actually runs on, compiled by Next.js itself.
 *
 * `getMiddlewareMatchers` is the function `next build` uses on this file's `config`, and it
 * does more to the source than compile it — it wraps every entry in the App Router's
 * transport suffixes (`.rsc`, segment prefetches) and the Pages Router's `_next/data`
 * prefix. Reading a matcher by eye therefore says nothing about what it matches, which is
 * exactly how a blanket "any dot in the last segment" exclusion would have dropped this file
 * out of every client-side navigation without a test noticing.
 *
 * @returns A predicate per entry of {@link config.matcher}, in order.
 */
async function compiledMatchers(): Promise<((path: string) => boolean)[]> {
  const { getMiddlewareMatchers } = (await import(
    "next/dist/build/analysis/get-page-static-info"
  )) as unknown as {
    getMiddlewareMatchers: (
      matcher: readonly string[],
      config: object,
    ) => { regexp: string }[];
  };

  return getMiddlewareMatchers(config.matcher, {}).map(({ regexp }) => {
    const compiled = new RegExp(regexp);
    return (path: string) => compiled.test(path);
  });
}

/** Whether any entry of the matcher admits a path — which is when Next.js runs the file. */
async function runsOn(path: string): Promise<boolean> {
  const matchers = await compiledMatchers();
  return matchers.some((matches) => matches(path));
}

beforeEach(() => {
  process.env[REST_URL_VAR] = REST;
  resetRestUrlCache();
});

afterEach(() => {
  delete process.env[REST_URL_VAR];
  resetRestUrlCache();
});

describe("the auth family, forwarded to ouroboros-rest", () => {
  it("rewrites onto the service under the same path", () => {
    // Not renamed on the way: github.com is registered against
    // `${BETTER_AUTH_URL}/api/auth/callback/github`, and a proxy that rewrote paths would
    // be one more thing that registration has to agree with.
    const response = proxy(request("/api/auth/callback/github"));

    expect(response.headers.get("x-middleware-rewrite")).toBe(
      `${REST}/api/auth/callback/github`,
    );
  });

  it("carries the query string, which for the OAuth callback is the whole point", () => {
    // The callback *is* its query string: dropping it strips the `code` and the `state` and
    // fails the exchange at the last hop.
    const response = proxy(request("/api/auth/callback/github?code=abc&state=xyz"));

    expect(response.headers.get("x-middleware-rewrite")).toBe(
      `${REST}/api/auth/callback/github?code=abc&state=xyz`,
    );
  });

  it("stamps nothing on it, because nothing renders from a rewrite", () => {
    const response = proxy(request("/api/auth/get-session"));

    expect(stamped(response)).toBeUndefined();
  });

  it("agrees with the auth client about where BetterAuth answers", () => {
    // The literal in this file and the constant in `app/api/auth-client.ts` are the same
    // string on both sides of the forward; a matcher cannot import one, so a test holds them
    // together. `auth-client.test.tsx` asserts the matcher entry; this asserts the branch.
    const response = proxy(request(`${AUTH_BASE_PATH}/get-session`));

    expect(response.headers.get("x-middleware-rewrite")).toBe(
      `${REST}${AUTH_BASE_PATH}/get-session`,
    );
  });
});

describe("every other request, carried on with its address", () => {
  it("tells the server the path it was made for", () => {
    const response = proxy(request("/dashboard"));

    expect(stamped(response)).toBe("/dashboard");
  });

  it("carries it as a request header rather than a response one", () => {
    // `NextResponse.next({headers})` would send it to the browser — a header naming every
    // page a person visited, in a response the browser may cache. The `request:` form is
    // what makes it readable by `headers()` in the render instead.
    const response = proxy(request("/dashboard"));

    expect(response.headers.get("x-middleware-override-headers")).toContain(
      REQUEST_PATH_HEADER,
    );
    expect(response.headers.get(REQUEST_PATH_HEADER)).toBeNull();
  });

  it("lets the request through — it is a signpost, not a gate", () => {
    const response = proxy(request("/dashboard"));

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    expect(response.status).toBe(200);
  });

  it("overwrites a header the caller sent, rather than appending to it", () => {
    // The security-relevant word is `set`. Without it a caller could choose where a
    // freshly signed-in visitor lands; with it, the value the server reads is this file's.
    const response = proxy(
      request("/dashboard", { [REQUEST_PATH_HEADER]: "https://evil.test" }),
    );

    expect(stamped(response)).toBe("/dashboard");
  });
});

describe("requestAddress", () => {
  it("keeps the query, because a deep link is often the query", () => {
    expect(requestAddress(new URL("http://localhost:3000/runs?status=failed"))).toBe(
      "/runs?status=failed",
    );
  });

  it("drops Next.js's own _rsc parameter", () => {
    // The router appends it to a navigation; nobody typed it. `?next=/dashboard?_rsc=1a2b`
    // would put the framework's internals in a person's address bar.
    expect(requestAddress(new URL("http://localhost:3000/dashboard?_rsc=1a2b"))).toBe(
      "/dashboard",
    );
  });

  it("keeps the rest of a query it appears in", () => {
    expect(
      requestAddress(new URL("http://localhost:3000/runs?status=failed&_rsc=1a2b")),
    ).toBe("/runs?status=failed");
  });

  it("leaves no trailing question mark when there is no query left", () => {
    expect(requestAddress(new URL("http://localhost:3000/dashboard?"))).toBe("/dashboard");
  });

  it("is origin-relative, which is all a return-to may ever be", () => {
    // `safeReturnTo` in `app/paths.ts` refuses anything else, so an absolute URL composed
    // here would be a value guaranteed to be thrown away.
    expect(requestAddress(new URL("http://localhost:3000/dashboard"))).not.toContain(
      "localhost",
    );
  });
});

describe("what the matcher runs on, compiled by Next.js's own function", () => {
  it("runs on every page route, including the root", async () => {
    for (const path of ["/", "/dashboard", "/login", "/runs"]) {
      expect(await runsOn(path)).toBe(true);
    }
  });

  it("runs on the App Router's transport forms of those routes", async () => {
    // The reason the exclusion names extensions rather than "any dot". A client-side
    // navigation arrives as `/dashboard.rsc`; a blanket dot-exclusion drops it, and with it
    // the return-to for every navigation after the first.
    for (const path of [
      "/dashboard.rsc",
      "/index.rsc",
      "/dashboard/.segments/x.segment.rsc",
    ]) {
      expect(await runsOn(path)).toBe(true);
    }
  });

  it("runs on the auth family, which is the forwarder's own entry", async () => {
    for (const path of ["/api/auth/get-session", "/api/auth/callback/github"]) {
      expect(await runsOn(path)).toBe(true);
    }
  });

  it("does not run on the generated family, which the browser never calls", async () => {
    // `/api/v1` is reached server-side, where the client already has the address.
    // Forwarding it would publish every operation on this origin — the property
    // `OURO_REST_URL` is unprefixed to prevent.
    expect(await runsOn("/api/v1/orgs")).toBe(false);
  });

  it("does not run on the framework's build output", async () => {
    for (const path of ["/_next/static/chunks/main.js", "/_next/image", "/_next/data/b/x.json"]) {
      expect(await runsOn(path)).toBe(false);
    }
  });

  it("does not run on anything in public/", async () => {
    for (const path of [
      "/favicon.ico",
      "/manifest.webmanifest",
      "/apple-touch-icon.png",
      "/icon-192.png",
      "/brand/icon-dark.png",
    ]) {
      expect(await runsOn(path)).toBe(false);
    }
  });
});

describe("the gate this file deliberately does not hold", () => {
  it("carries a request with no session cookie straight through", async () => {
    // The middleware decision #720 records, as a case. An edge check could only read
    // *a cookie is present*, which is weaker than *this person belongs to the workspace
    // this screen renders* — so it would refuse nothing `requireWorkspace()` does not, and
    // would be a second authority that can disagree with the first. `proxy.ts` §
    // *Why this file is not the auth gate* is the argument; `access.test.ts` is the gate.
    const response = proxy(request("/dashboard"));

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("Location")).toBeNull();
    expect(response.status).toBe(200);
  });

  it("reads no cookie at all, so a prefetch costs nothing", async () => {
    // Proxy runs on every prefetched route. A session read here would be a call to
    // `ouroboros-rest` per prefetch, for an answer the render is about to fetch anyway.
    const signedIn = proxy(request("/dashboard", { cookie: "better-auth.session_token=x" }));
    const signedOut = proxy(request("/dashboard"));

    expect(stamped(signedIn)).toBe(stamped(signedOut));
    expect(signedIn.headers.get("x-middleware-next")).toBe(
      signedOut.headers.get("x-middleware-next"),
    );
  });
});
