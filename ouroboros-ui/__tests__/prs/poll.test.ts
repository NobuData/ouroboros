import { afterEach, describe, expect, it, vi } from "vitest";

import { UNREADABLE_PAGE, createPagePoll, isPullRequestPage, pageUrl } from "@/app/prs/poll";

import { PR_514_ID, prPage } from "../helpers/pull-requests";

/**
 * The PR verification page's poll reader (#363): the address, the guard, and a read through
 * `fetch`. The loop itself — cadence, visibility, `X-Ouro-Poll-After` — is `poll.test.ts`'s.
 */

/**
 * A `fetch` answering one response.
 *
 * @param body What to answer with, serialised as JSON.
 * @returns The stub.
 */
function fetching(body: unknown) {
  const stub = vi.fn<(url: string) => Promise<Response>>(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
  vi.stubGlobal("fetch", stub);
  return stub;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the address", () => {
  it("is this origin's, with the id encoded", () => {
    expect(pageUrl(PR_514_ID)).toBe(`/api/prs/${PR_514_ID}`);
    expect(pageUrl("a/../b")).toBe("/api/prs/a%2F..%2Fb");
  });
});

describe("the guard", () => {
  it("accepts a page — with or without a revision, a snapshot or a review", () => {
    expect(isPullRequestPage(prPage())).toBe(true);
    expect(isPullRequestPage(prPage({ revisions: [], gates: null, review: null }))).toBe(true);
  });

  it("refuses what is not one", () => {
    const page = prPage();

    expect(isPullRequestPage({ ...page, pullRequest: { ...page.pullRequest, number: "514" } })).toBe(
      false,
    );
    expect(isPullRequestPage({ ...page, revisions: undefined })).toBe(false);
    expect(isPullRequestPage({ ...page, gates: { rows: "none" } })).toBe(false);
    expect(isPullRequestPage({ ...page, plan: null })).toBe(false);
    expect(isPullRequestPage({ pullRequest: null })).toBe(false);
    expect(isPullRequestPage(null)).toBe(false);
    expect(isPullRequestPage("page")).toBe(false);
  });
});

describe("the read", () => {
  it("asks this origin for the page, and refuses a body that is not one", async () => {
    const stub = fetching(prPage());
    const poll = createPagePoll(PR_514_ID, { visible: () => true });
    const stop = poll.start();

    await vi.waitFor(() => expect(poll.snapshot().data).toEqual(prPage()));
    expect(stub.mock.calls[0]![0]).toBe(pageUrl(PR_514_ID));
    stop();

    fetching({ nope: true });
    const broken = createPagePoll(PR_514_ID, { visible: () => true });
    const stopBroken = broken.start();
    await vi.waitFor(() => expect(broken.snapshot().error).toBe(UNREADABLE_PAGE));
    stopBroken();
  });
});
