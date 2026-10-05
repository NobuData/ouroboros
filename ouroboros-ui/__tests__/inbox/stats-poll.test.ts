import { afterEach, describe, expect, it, vi } from "vitest";

import { INBOX_STATS_ENDPOINT, createStatsPoll, isInboxStats, requestStats } from "@/app/inbox/stats-poll";
import { UNREACHABLE_STATS, UNREADABLE_STATS } from "@/app/inbox/stats-view";

import { coldStats, inboxStats } from "../helpers/inbox";

/** The week's stat card's poll (BO.5, #470): one endpoint, and a guard on what comes back. */

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("where the week is asked for", () => {
  it("is this origin's route", () => {
    expect(INBOX_STATS_ENDPOINT).toBe("/api/inbox/stats");
  });
});

describe("what counts as the week", () => {
  it("accepts the seeded week and a cold one", () => {
    expect(isInboxStats(inboxStats())).toBe(true);
    expect(isInboxStats(coldStats())).toBe(true);
  });

  it.each([
    ["nothing", null],
    ["a string", "11"],
    ["an empty object", {}],
    ["a week with no printing", { ...inboxStats(), display: undefined }],
    ["a null printing", { ...inboxStats(), display: null }],
    ["a printing missing the median", { ...inboxStats(), display: { decisions: "11", maxLoopWait: "6m" } }],
    [
      "a figure printed as a number",
      { ...inboxStats(), display: { decisions: 11, medianAnswer: "41s", maxLoopWait: "6m" } },
    ],
    ["a count that is a string", { ...inboxStats(), decisions: "11" }],
    ["a median that is not finite", { ...inboxStats(), medianAnswerSeconds: Number.NaN }],
    ["no week", { ...inboxStats(), week: undefined }],
  ])("refuses %s", (_label, value) => {
    expect(isInboxStats(value)).toBe(false);
  });
});

describe("one read on this origin", () => {
  /** Answer the next fetch with a JSON body. */
  function answering(body: unknown, status = 200): ReturnType<typeof vi.fn> {
    const fetch = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })),
    );

    vi.stubGlobal("fetch", fetch);

    return fetch;
  }

  it("asks the stats route and answers what it sent", async () => {
    const fetch = answering(inboxStats());

    const answer = await requestStats(null);

    expect(String(fetch.mock.calls[0]![0])).toContain("/api/inbox/stats");
    expect(answer).toMatchObject({ state: "fresh", payload: inboxStats() });
  });

  it("says unreadable for an answer that is not the week", async () => {
    answering({ decisions: 11 });

    expect(await requestStats(null)).toMatchObject({ state: "failed", reason: UNREADABLE_STATS });
  });

  it("says unreachable when nothing answers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("fetch failed"))),
    );

    expect(await requestStats(null)).toMatchObject({ state: "failed", reason: UNREACHABLE_STATS });
  });
});

describe("the week's poll", () => {
  it("reads through the reader it was given", async () => {
    const read = vi
      .fn()
      .mockResolvedValue({ state: "fresh", payload: inboxStats(), etag: null, pollAfterSeconds: null });
    const poll = createStatsPoll({ read, visible: () => true });
    const stop = poll.start();

    await vi.waitFor(() => expect(poll.snapshot().data).toEqual(inboxStats()));
    stop();

    expect(read).toHaveBeenCalled();
  });
});
