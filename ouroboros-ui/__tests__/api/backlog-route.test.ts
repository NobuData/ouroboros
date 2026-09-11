import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BacklogListing, BacklogQuery } from "@/app/api/backlog";
import { CACHE_CONTROL } from "@/app/api/poll-response";
import { PAGE_SIZE } from "@/app/issues/paging";
import type { PollAnswer } from "@/app/poll";

import { HELIOS, backlogListing } from "../helpers/issues";

/**
 * `GET /api/backlog` — one page of the backlog, on the origin the browser can reach (#117).
 *
 * Two things are the handler's own. The address: it reads the query string with the page's two
 * parsers, so the poll asks for exactly the view on screen and nothing else from the address
 * reaches the service. And the translation from an answer to a response, which is
 * `app/api/poll-response.ts`'s and is held here from the backlog's side — `dashboard-route.test.ts`
 * holds it from the dashboard's.
 */

vi.mock("server-only", () => ({}));

/** What the stubbed reader answers with. Reassigned per case. */
let answer: PollAnswer<BacklogListing> = { state: "gone" };

/** What the reader was asked for. */
let askedWith: BacklogQuery | undefined;

vi.mock("@/app/api/backlog-page", () => ({
  readBacklogPage: (query: BacklogQuery) => {
    askedWith = query;
    return Promise.resolve(answer);
  },
}));

const { BACKLOG_UNAVAILABLE_CODE, GET } = await import("@/app/api/backlog/route");

/**
 * One poll.
 *
 * @param search The query string, with or without its `?`.
 * @returns The request to hand the handler.
 */
function poll(search = ""): Request {
  return new Request(`http://ui.test/api/backlog${search}`);
}

beforeEach(() => {
  askedWith = undefined;
  answer = { state: "fresh", payload: backlogListing(), etag: null, pollAfterSeconds: null };
});

describe("the address", () => {
  it("asks for the default view's first page for a bare address", async () => {
    await GET(poll());

    expect(askedWith).toEqual({ state: "open", sort: "effort", limit: PAGE_SIZE, offset: 0 });
  });

  it("reads the five controls and the page exactly as the route does", async () => {
    await GET(poll(`?repo=${HELIOS.id}&labels=bug&labels=tech-debt&state=closed&sort=number&q=bus&page=2`));

    expect(askedWith).toEqual({
      repo: HELIOS.id,
      labels: ["bug", "tech-debt"],
      state: "closed",
      sort: "number",
      q: "bus",
      limit: PAGE_SIZE,
      offset: PAGE_SIZE,
    });
  });

  it("lets nothing else through, and falls back where the route would", async () => {
    await GET(poll("?limit=1000&offset=5&foo=bar&state=archived&page=zero"));

    expect(askedWith).toEqual({ state: "open", sort: "effort", limit: PAGE_SIZE, offset: 0 });
  });
});

describe("the answer", () => {
  it("answers a page with the listing, uncacheable by anything shared", async () => {
    const response = await GET(poll());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(backlogListing());
    expect(response.headers.get("Cache-Control")).toBe(CACHE_CONTROL);
    expect(response.headers.get("ETag")).toBeNull();
  });

  it("tells a poll plainly that the session is over, rather than redirecting it", async () => {
    answer = { state: "gone" };

    const response = await GET(poll());

    expect(response.status).toBe(401);
    expect(response.headers.get("Location")).toBeNull();
    expect((await response.json()).code).toBe("unauthenticated");
  });

  it("reports a failed read as this origin's own, carrying the service's sentence", async () => {
    answer = { state: "failed", reason: "The database is not answering.", pollAfterSeconds: null };

    const response = await GET(poll());

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      code: BACKLOG_UNAVAILABLE_CODE,
      message: "The database is not answering.",
    });
    expect(BACKLOG_UNAVAILABLE_CODE).toBe("backlog_unavailable");
  });
});
