import { describe, expect, it, vi } from "vitest";

import { UNREACHABLE_SUMMARY, UNREADABLE_SUMMARY } from "@/app/dashboard/summary";

import { summary } from "../helpers/dashboard";

/**
 * The server's half of the conditional exchange
 * ([#87](https://github.com/NobuData/ouroboros/issues/87)).
 *
 * Its subject is the thing the typed client could not have done: **a `304` is an answer**,
 * not a failure. `app/api/client.ts`'s middleware turns every non-`ok` response into a
 * thrown `ApiError`, so the cheapest and commonest answer in the whole polling contract
 * would have arrived as a rejection about an unreadable envelope — which is why this reader
 * uses `fetch`, exactly as `app/api/health.ts` does, and why these cases are worth having.
 *
 * The other half of the subject is that **nothing it can meet throws**. Its caller is a
 * route handler answering a poll on a timer; there is no error boundary behind it that
 * could render anything better than the poll can.
 */

// Server-only for the reason every reader of `OURO_REST_URL` is. Nothing here reaches the
// environment — every case passes its own base URL — but the import needs the marker to
// resolve, and `next/headers` needs to answer for the session cookies.
vi.mock("server-only", () => ({}));

/** What the fake cookie jar holds. Reassigned per case. */
let jar: Record<string, string> = {};

vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        jar[name] === undefined ? undefined : { name, value: jar[name] },
    }),
}));

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const { SUMMARY_PATH, SUMMARY_TIMEOUT_MS, readDashboardSummary } = await import(
  "@/app/api/dashboard-summary"
);

const BASE = "http://rest.test:4000";

/** The tag the service issues in these cases — strong, and quoted as a strong tag is. */
const TAG = '"v1-abc"';

/**
 * A stub `fetch` answering once, recording what it was asked.
 *
 * @param answer The response to give.
 * @returns The stub, and the calls made through it.
 */
function stub(answer: Response) {
  const calls: [string, RequestInit | undefined][] = [];

  return {
    calls,
    fetcher: (input: string, init?: RequestInit) => {
      calls.push([input, init]);
      return Promise.resolve(answer);
    },
  };
}

/**
 * The headers of the one request a case made.
 *
 * @param calls What the stub recorded.
 * @returns The headers, as a plain object — the reader composes them as one.
 */
function sentHeaders(calls: [string, RequestInit | undefined][]): Record<string, string> {
  return (calls[0]?.[1]?.headers ?? {}) as Record<string, string>;
}

describe("readDashboardSummary", () => {
  it("asks the aggregate at the path the contract publishes", async () => {
    jar = {};
    const { calls, fetcher } = stub(Response.json(summary()));

    await readDashboardSummary({ fetcher, baseUrl: BASE });

    expect(calls[0]?.[0]).toBe(`${BASE}${SUMMARY_PATH}`);
    expect(SUMMARY_PATH).toBe("/api/v1/dashboard");
  });

  it("returns the payload and the tag a changed dashboard answers with", async () => {
    jar = {};
    const payload = summary();
    const { fetcher } = stub(
      Response.json(payload, { headers: { ETag: TAG, "X-Ouro-Poll-After": "15" } }),
    );

    expect(await readDashboardSummary({ fetcher, baseUrl: BASE })).toEqual({
      state: "fresh",
      summary: payload,
      etag: TAG,
      pollAfterSeconds: 15,
    });
  });

  it("reads a 304 as an answer rather than as a failure", async () => {
    // The whole reason this module does not go through the typed client: that middleware
    // would have thrown here, and *nothing has changed* is the answer the contract is built
    // around.
    jar = {};
    const { fetcher } = stub(
      new Response(null, { status: 304, headers: { ETag: TAG, "X-Ouro-Poll-After": "30" } }),
    );

    expect(await readDashboardSummary({ etag: TAG, fetcher, baseUrl: BASE })).toEqual({
      state: "unchanged",
      etag: TAG,
      pollAfterSeconds: 30,
    });
  });

  it("echoes the tag it was given, verbatim", async () => {
    jar = {};
    const { calls, fetcher } = stub(new Response(null, { status: 304 }));

    await readDashboardSummary({ etag: TAG, fetcher, baseUrl: BASE });

    // Quotes and all: the tag travelled here from the service through this application's
    // own hands, and rewriting it is how a strong tag stops matching.
    expect(sentHeaders(calls)["If-None-Match"]).toBe(TAG);
  });

  it("asks unconditionally when it holds no tag", async () => {
    jar = {};
    const { calls, fetcher } = stub(Response.json(summary()));

    await readDashboardSummary({ fetcher, baseUrl: BASE });

    expect(sentHeaders(calls)).not.toHaveProperty("If-None-Match");
  });

  it("forwards both session cookies, and nothing else the browser sent", async () => {
    jar = {
      "better-auth.session_token": "token-value",
      "better-auth.session_data": "cache-value",
      ouro_theme: "dark",
    };
    const { calls, fetcher } = stub(Response.json(summary()));

    await readDashboardSummary({ fetcher, baseUrl: BASE });

    const cookie = sentHeaders(calls).Cookie;
    expect(cookie).toBe("better-auth.session_token=token-value; better-auth.session_data=cache-value");
    // The theme is this UI's business and none of the service's — `app/api/client.ts` is
    // where that rule is written, and this reader borrows its composer rather than its own.
    expect(cookie).not.toContain("ouro_theme");
  });

  it("sends no Cookie header at all for a browser carrying no session", async () => {
    jar = {};
    const { calls, fetcher } = stub(Response.json(summary(), { status: 401 }));

    await readDashboardSummary({ fetcher, baseUrl: BASE });

    expect(sentHeaders(calls)).not.toHaveProperty("Cookie");
  });

  it("names a 401 as its own answer rather than redirecting", async () => {
    // A poll is not a render. Throwing Next.js's redirect signal here would answer the poll
    // with a login page, which it would then try to read as a dashboard.
    jar = {};
    const { fetcher } = stub(
      Response.json({ code: "unauthenticated", message: "no" }, { status: 401 }),
    );

    expect(await readDashboardSummary({ fetcher, baseUrl: BASE })).toEqual({ state: "gone" });
  });

  it("passes on the sentence the service refused with", async () => {
    jar = {};
    const { fetcher } = stub(
      Response.json(
        { code: "forbidden_role", message: "You are not a member of that workspace.", details: {} },
        { status: 403, headers: { "X-Ouro-Poll-After": "60" } },
      ),
    );

    expect(await readDashboardSummary({ fetcher, baseUrl: BASE })).toEqual({
      state: "failed",
      reason: "You are not a member of that workspace.",
      pollAfterSeconds: 60,
    });
  });

  it("reads a 200 that is not a dashboard as a failure rather than as a payload", async () => {
    // A proxy, a captive portal or a misconfigured base URL can each reply 200 with
    // something else entirely, and a pill drawn from it would be a number nobody computed.
    jar = {};
    const { fetcher } = stub(Response.json({ hello: "world" }));

    expect(await readDashboardSummary({ fetcher, baseUrl: BASE })).toEqual({
      state: "failed",
      reason: UNREADABLE_SUMMARY,
      pollAfterSeconds: null,
    });
  });

  it("reads a 200 that is not JSON as a failure", async () => {
    jar = {};
    const { fetcher } = stub(new Response("<html>maintenance</html>", { status: 200 }));

    expect(await readDashboardSummary({ fetcher, baseUrl: BASE })).toEqual({
      state: "failed",
      reason: UNREADABLE_SUMMARY,
      pollAfterSeconds: null,
    });
  });

  it("reports a service that never answered, without throwing", async () => {
    jar = {};
    const fetcher = () => Promise.reject(new TypeError("fetch failed"));

    expect(await readDashboardSummary({ fetcher, baseUrl: BASE })).toEqual({
      state: "failed",
      reason: UNREACHABLE_SUMMARY,
      pollAfterSeconds: null,
    });
  });

  it("bounds how long it will wait", async () => {
    jar = {};
    const { calls, fetcher } = stub(Response.json(summary()));

    await readDashboardSummary({ fetcher, baseUrl: BASE });

    // Comfortably inside the contract's fifteen-second cadence: a service that stopped
    // answering must cost one slow poll, not a loop that never schedules another.
    expect(SUMMARY_TIMEOUT_MS).toBeLessThan(15_000);
    expect(calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("keeps the browser's cache out of the exchange", async () => {
    jar = {};
    const { calls, fetcher } = stub(Response.json(summary()));

    await readDashboardSummary({ fetcher, baseUrl: BASE });

    expect(calls[0]?.[1]?.cache).toBe("no-store");
  });

  it("ignores a cadence hint outside the bounds the contract states", async () => {
    jar = {};
    const { fetcher } = stub(
      Response.json(summary(), { headers: { "X-Ouro-Poll-After": "99999" } }),
    );

    const answer = await readDashboardSummary({ fetcher, baseUrl: BASE });

    expect(answer.state === "fresh" && answer.pollAfterSeconds).toBeNull();
  });
});
