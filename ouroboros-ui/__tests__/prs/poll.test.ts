import { afterEach, describe, expect, it, vi } from "vitest";

import { UNREADABLE_PAGE, createPagePoll, isPullRequestPage, pageUrl } from "@/app/prs/poll";

import {
  PR_514_ID,
  armedPlan,
  mergePlan,
  mergedPlan,
  prPage,
  seededSpend,
} from "../helpers/pull-requests";

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

  it("accepts every plan and spend the cards draw (#369)", () => {
    for (const plan of [mergePlan(), armedPlan(), mergedPlan()]) {
      expect(isPullRequestPage(prPage({ plan }))).toBe(true);
    }
    expect(isPullRequestPage(prPage({ spend: seededSpend() }))).toBe(true);
    expect(isPullRequestPage(prPage({ spend: null }))).toBe(true);
  });

  it("accepts a plan from a service that does not name who armed it yet", () => {
    const older: Partial<ReturnType<typeof armedPlan>> = armedPlan();
    delete older.armedByPerson;

    expect(isPullRequestPage({ ...prPage(), plan: older })).toBe(true);
  });

  it("reads a page with no sync stamp at all — a service one release behind (#370)", () => {
    const older: Partial<ReturnType<typeof prPage>["pullRequest"]> = { ...prPage().pullRequest };
    delete older.syncedAt;

    expect(isPullRequestPage({ ...prPage(), pullRequest: older })).toBe(true);
    expect(isPullRequestPage(prPage({ pullRequest: { syncedAt: null } }))).toBe(true);
  });

  it("refuses a plan or a spend a card could not draw, so the last good page stays", () => {
    const page = prPage({ spend: seededSpend() });

    for (const plan of [
      {},
      { ...mergePlan(), commitMessage: null },
      { ...mergePlan(), armed: "yes" },
      { ...mergePlan(), closeTicket: undefined },
      { ...mergePlan(), strategy: 1 },
      { ...mergePlan(), mergedResult: {} },
      { ...mergePlan(), mergedResult: { sha: "9c4ab7f", identityUsed: "ken-s" } },
      { ...mergePlan(), mergedResult: "merged" },
    ]) {
      expect(isPullRequestPage({ ...page, plan })).toBe(false);
    }

    for (const spend of [undefined, "none", {}, { loop: null, verification: {} }, { loop: {} }]) {
      expect(isPullRequestPage({ ...page, spend })).toBe(false);
    }
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
