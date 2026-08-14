import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SummaryAnswer } from "@/app/dashboard/summary";

import { summary } from "../helpers/dashboard";

/**
 * `GET /api/dashboard` — the exchange on the origin the browser can reach
 * ([#87](https://github.com/NobuData/ouroboros/issues/87)).
 *
 * The handler decides nothing about *what* the dashboard says; that is
 * `app/api/dashboard-summary.ts`, covered beside this. What is here is the translation
 * between an answer and HTTP, and it is worth its own suite because the contract's cheap
 * half lives entirely in the translation: a `304` must carry **no body**, must still carry
 * the tag and the cadence hint, and a failure must not be handed the tag of a payload it is
 * not carrying.
 *
 * The reader is stubbed rather than the network, so each case is one answer in and one
 * response out.
 */

vi.mock("server-only", () => ({}));

/** What the stubbed reader answers with. Reassigned per case. */
let answer: SummaryAnswer = { state: "gone" };

/** What the reader was asked for — the tag the poll echoed, or `null`. */
let askedWith: string | null | undefined;

vi.mock("@/app/api/dashboard-summary", () => ({
  readDashboardSummary: (options: { etag?: string | null }) => {
    askedWith = options.etag;
    return Promise.resolve(answer);
  },
}));

const { CACHE_CONTROL, GET } = await import("@/app/api/dashboard/route");

const TAG = '"v1-abc"';

/**
 * One poll.
 *
 * @param etag The tag the browser holds, if any.
 * @returns The request to hand the handler.
 */
function poll(etag?: string): Request {
  return new Request("http://ui.test/api/dashboard", {
    headers: etag === undefined ? {} : { "If-None-Match": etag },
  });
}

beforeEach(() => {
  askedWith = undefined;
});

describe("the dashboard poll endpoint", () => {
  it("hands the reader the tag the browser is holding", async () => {
    answer = { state: "unchanged", etag: TAG, pollAfterSeconds: 15 };

    await GET(poll(TAG));

    expect(askedWith).toBe(TAG);
  });

  it("asks unconditionally for a browser holding nothing", async () => {
    answer = { state: "fresh", summary: summary(), etag: TAG, pollAfterSeconds: 15 };

    await GET(poll());

    expect(askedWith).toBeNull();
  });

  it("answers a changed dashboard with the payload, its tag and the cadence", async () => {
    const payload = summary();
    answer = { state: "fresh", summary: payload, etag: TAG, pollAfterSeconds: 15 };

    const response = await GET(poll());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(payload);
    expect(response.headers.get("ETag")).toBe(TAG);
    expect(response.headers.get("X-Ouro-Poll-After")).toBe("15");
    expect(response.headers.get("Cache-Control")).toBe(CACHE_CONTROL);
  });

  it("answers an unchanged dashboard with no body at all", async () => {
    answer = { state: "unchanged", etag: TAG, pollAfterSeconds: 30 };

    const response = await GET(poll(TAG));

    expect(response.status).toBe(304);
    expect(await response.text()).toBe("");
    // The hint rides the 304 as well as the 200 — a backed-off server answers mostly 304s,
    // so the cheap answer has to carry the cadence or a slowed client never hears it change.
    expect(response.headers.get("X-Ouro-Poll-After")).toBe("30");
    expect(response.headers.get("ETag")).toBe(TAG);
  });

  it("tells a poll plainly that the session is over, rather than redirecting it", async () => {
    // A 3xx here would be answered with a login page, which the poll would then try to read
    // as a dashboard.
    answer = { state: "gone" };

    const response = await GET(poll(TAG));

    expect(response.status).toBe(401);
    expect(response.headers.get("Location")).toBeNull();
    expect((await response.json()).code).toBe("unauthenticated");
  });

  it("reports a failed read as this origin's own, carrying the service's sentence", async () => {
    answer = { state: "failed", reason: "The database is not answering.", pollAfterSeconds: 60 };

    const response = await GET(poll(TAG));

    // 502 rather than the service's own status: the browser is talking to this origin, and
    // passing somebody else's 500 through would send a poll looking in the wrong place.
    expect(response.status).toBe(502);
    expect((await response.json()).message).toBe("The database is not answering.");
    expect(response.headers.get("X-Ouro-Poll-After")).toBe("60");
  });

  it("never tags an answer that carries no payload", async () => {
    answer = { state: "failed", reason: "nope", pollAfterSeconds: null };

    const response = await GET(poll(TAG));

    expect(response.headers.get("ETag")).toBeNull();
  });

  it("omits the cadence hint rather than inventing one", async () => {
    // The browser already knows the contract's default; a hint made up here would be this
    // origin's opinion wearing the service's header.
    answer = { state: "fresh", summary: summary(), etag: TAG, pollAfterSeconds: null };

    const response = await GET(poll());

    expect(response.headers.get("X-Ouro-Poll-After")).toBeNull();
  });

  it("lets no shared cache hold one workspace's numbers", async () => {
    answer = { state: "fresh", summary: summary(), etag: TAG, pollAfterSeconds: 15 };

    const response = await GET(poll());

    expect(CACHE_CONTROL).toContain("private");
    expect(CACHE_CONTROL).toContain("no-cache");
    expect(response.headers.get("Cache-Control")).toBe(CACHE_CONTROL);
  });
});
