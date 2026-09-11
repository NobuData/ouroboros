import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DETAIL_ENDPOINT,
  UNREACHABLE_ISSUE,
  UNREADABLE_ISSUE,
  createDetailPoll,
  detailUrl,
  isIssueDetail,
  requestDetail,
} from "@/app/issues/detail-poll";
import { IF_NONE_MATCH_HEADER } from "@/app/poll";

import { estimatingDetail, issueDetail, issueId } from "../helpers/issues";

/**
 * The detail panel's poll reader (#119): the address it asks, the guard that decides whether
 * what answered is an issue, and the four answers a read can come back as. The loop itself is
 * `poll.test.ts`'s.
 */

/**
 * A `fetch` answering one response.
 *
 * @param body What to answer with, serialised as JSON — or a string, sent as is.
 * @param status The status.
 * @param headers Any headers.
 * @returns The stub, and the requests it saw.
 */
function fetching(body: unknown, status = 200, headers: Record<string, string> = {}) {
  const requests: { url: string; headers: Headers }[] = [];
  const stub = vi.fn((url: string, init: RequestInit) => {
    requests.push({ url, headers: new Headers(init.headers) });
    return Promise.resolve(
      new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json", ...headers },
      }),
    );
  });
  vi.stubGlobal("fetch", stub);
  return { stub, requests };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the address", () => {
  it("is this origin's, with the id as its last segment", () => {
    expect(detailUrl(issueId(485))).toBe(`${DETAIL_ENDPOINT}/${issueId(485)}`);
    expect(detailUrl("a/b")).toBe("/api/backlog/a%2Fb");
  });
});

describe("isIssueDetail", () => {
  it("accepts the seeded answer, with an estimate and without one", () => {
    expect(isIssueDetail(issueDetail())).toBe(true);
    expect(isIssueDetail(estimatingDetail())).toBe(true);
  });

  it("refuses what is not an issue — a listing, an envelope, nothing", () => {
    expect(isIssueDetail({ items: [], total: 0, offset: 0, meta: {} })).toBe(false);
    expect(isIssueDetail({ code: "issue_not_found", message: "none" })).toBe(false);
    expect(isIssueDetail(null)).toBe(false);
    expect(isIssueDetail({ issue: { id: 485 }, estimate: null, history: [] })).toBe(false);
    expect(isIssueDetail({ issue: issueDetail().issue, estimate: "none", history: [] })).toBe(false);
    expect(isIssueDetail({ issue: issueDetail().issue, estimate: null })).toBe(false);
  });
});

describe("requestDetail", () => {
  it("asks the address with the tag it holds, and answers fresh with the issue", async () => {
    const { requests } = fetching(issueDetail(), 200, { ETag: '"v1"' });

    const answer = await requestDetail(detailUrl(issueId(485)))('"v0"');

    expect(requests[0]?.url).toBe(detailUrl(issueId(485)));
    expect(requests[0]?.headers.get(IF_NONE_MATCH_HEADER)).toBe('"v0"');
    expect(answer).toEqual({ state: "fresh", payload: issueDetail(), etag: '"v1"', pollAfterSeconds: null });
  });

  it("answers failed with the service's sentence for a refusal, and its own for a body it cannot read", async () => {
    fetching({ code: "backlog_unavailable", message: "No issue with that id." }, 502);
    expect(await requestDetail("/api/backlog/x")(null)).toEqual({
      state: "failed",
      reason: "No issue with that id.",
      pollAfterSeconds: null,
    });

    fetching({ hello: "world" });
    expect(await requestDetail("/api/backlog/x")(null)).toEqual({
      state: "failed",
      reason: UNREADABLE_ISSUE,
      pollAfterSeconds: null,
    });
  });

  it("answers gone for a session that has ended, and unreachable when nothing answered", async () => {
    fetching({ code: "unauthenticated", message: "gone" }, 401);
    expect(await requestDetail("/api/backlog/x")(null)).toEqual({ state: "gone" });

    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("fetch failed")));
    expect(await requestDetail("/api/backlog/x")(null)).toEqual({
      state: "failed",
      reason: UNREACHABLE_ISSUE,
      pollAfterSeconds: null,
    });
  });
});

describe("createDetailPoll", () => {
  it("builds an inert loop over the reader it was given", () => {
    const read = vi.fn();
    const poll = createDetailPoll("/api/backlog/x", { read });

    expect(poll.snapshot()).toEqual({ data: null, updatedAt: null, error: null });
    expect(read).not.toHaveBeenCalled();
  });
});
