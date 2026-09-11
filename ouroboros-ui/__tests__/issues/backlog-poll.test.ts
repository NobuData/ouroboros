import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BACKLOG_ENDPOINT,
  UNREACHABLE_BACKLOG,
  UNREADABLE_BACKLOG,
  backlogUrl,
  createBacklogPoll,
  isBacklogListing,
  requestBacklog,
} from "@/app/issues/backlog-poll";
import { DEFAULT_FILTER } from "@/app/issues/filter";

import { HELIOS, backlogListing } from "../helpers/issues";

/**
 * The table's poll — the backlog's reader over `app/poll.ts`'s loop (#117).
 *
 * The loop is `summary-poll.test.ts`'s, case by case. What is here is what this reader adds: the
 * address it asks, the guard that decides whether what answered is a listing, and the four
 * answers one read can come back as.
 */

/** What the stubbed `fetch` was asked, per case. */
let asked: { url: string; headers: Headers } | null = null;

/**
 * Install a `fetch` that answers one way.
 *
 * @param answer The response, or the error to reject with.
 */
function stubFetch(answer: Response | Error): void {
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    asked = { url: String(input), headers: new Headers(init?.headers) };
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  });
}

beforeEach(() => {
  asked = null;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("backlogUrl", () => {
  it("is the endpoint alone for the default view's first page", () => {
    expect(backlogUrl(DEFAULT_FILTER, 1)).toBe(BACKLOG_ENDPOINT);
  });

  it("carries the view's own query string, so the handler parses the address the page came from", () => {
    expect(backlogUrl({ ...DEFAULT_FILTER, repo: HELIOS.id, labels: ["bug"] }, 2)).toBe(
      `${BACKLOG_ENDPOINT}?repo=${HELIOS.id}&labels=bug&page=2`,
    );
  });
});

describe("isBacklogListing", () => {
  it("accepts a listing", () => {
    expect(isBacklogListing(backlogListing())).toBe(true);
    expect(isBacklogListing(backlogListing({ items: [] }))).toBe(true);
  });

  it("refuses what is not one", () => {
    expect(isBacklogListing(null)).toBe(false);
    expect(isBacklogListing("rows")).toBe(false);
    expect(isBacklogListing({})).toBe(false);
    expect(isBacklogListing({ ...backlogListing(), items: "none" })).toBe(false);
    expect(isBacklogListing({ ...backlogListing(), total: "9" })).toBe(false);
    expect(isBacklogListing({ ...backlogListing(), meta: null })).toBe(false);
  });
});

describe("requestBacklog", () => {
  it("asks the address it was built for, on this origin, without the browser's cache", async () => {
    stubFetch(Response.json(backlogListing()));

    const answer = await requestBacklog(`${BACKLOG_ENDPOINT}?page=2`)(null);

    expect(asked?.url).toBe(`${BACKLOG_ENDPOINT}?page=2`);
    expect(asked?.headers.get("Accept")).toBe("application/json");
    expect(asked?.headers.has("If-None-Match")).toBe(false);
    expect(answer).toEqual({ state: "fresh", payload: backlogListing(), etag: null, pollAfterSeconds: null });
  });

  it("echoes a tag it holds", async () => {
    stubFetch(new Response(null, { status: 304 }));

    const answer = await requestBacklog(BACKLOG_ENDPOINT)('"v1"');

    expect(asked?.headers.get("If-None-Match")).toBe('"v1"');
    expect(answer).toEqual({ state: "unchanged", etag: null, pollAfterSeconds: null });
  });

  it("reads a body that is not a listing as unreadable, whatever its status", async () => {
    stubFetch(Response.json({ hello: "world" }));

    expect(await requestBacklog(BACKLOG_ENDPOINT)(null)).toEqual({
      state: "failed",
      reason: UNREADABLE_BACKLOG,
      pollAfterSeconds: null,
    });
  });

  it("reads the session ending as gone", async () => {
    stubFetch(Response.json({ code: "unauthenticated", message: "Gone." }, { status: 401 }));

    expect(await requestBacklog(BACKLOG_ENDPOINT)(null)).toEqual({ state: "gone" });
  });

  it("carries the handler's sentence for a failed read", async () => {
    stubFetch(
      Response.json({ code: "backlog_unavailable", message: "The database is not answering." }, { status: 502 }),
    );

    expect(await requestBacklog(BACKLOG_ENDPOINT)(null)).toEqual({
      state: "failed",
      reason: "The database is not answering.",
      pollAfterSeconds: null,
    });
  });

  it("says unreachable when nothing answered at all", async () => {
    stubFetch(new TypeError("fetch failed"));

    expect(await requestBacklog(BACKLOG_ENDPOINT)(null)).toEqual({
      state: "failed",
      reason: UNREACHABLE_BACKLOG,
      pollAfterSeconds: null,
    });
  });
});

describe("createBacklogPoll", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads through the seam when given one, and nothing else", async () => {
    const read = vi.fn().mockResolvedValue({ state: "fresh", payload: backlogListing(), etag: null, pollAfterSeconds: null });
    stubFetch(new TypeError("must not be called"));
    const poll = createBacklogPoll(BACKLOG_ENDPOINT, { read, visible: () => true });

    const stop = poll.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(read).toHaveBeenCalledExactlyOnceWith(null);
    expect(poll.snapshot().data).toEqual(backlogListing());
    expect(asked).toBeNull();
    stop();
  });

  it("reads the address it was built for otherwise", async () => {
    stubFetch(Response.json(backlogListing()));
    const poll = createBacklogPoll(`${BACKLOG_ENDPOINT}?page=3`, { visible: () => true });

    const stop = poll.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(asked?.url).toBe(`${BACKLOG_ENDPOINT}?page=3`);
    expect(poll.snapshot().data).toEqual(backlogListing());
    stop();
  });
});
