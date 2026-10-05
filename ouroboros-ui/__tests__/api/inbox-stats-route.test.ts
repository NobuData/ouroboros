import { beforeEach, describe, expect, it, vi } from "vitest";

import { inboxStats } from "../helpers/inbox";

/** `GET /api/inbox/stats` (#470): the week's stat card, answered in the poll family's shape. */

const readInboxStats = vi.fn();

vi.mock("@/app/api/inbox-stats", () => ({
  INBOX_STATS_UNAVAILABLE_CODE: "inbox_stats_unavailable",
  readInboxStats: () => readInboxStats(),
}));

const { GET } = await import("@/app/api/inbox/stats/route");

beforeEach(() => {
  readInboxStats
    .mockReset()
    .mockResolvedValue({ state: "fresh", payload: inboxStats(), etag: null, pollAfterSeconds: null });
});

describe("GET /api/inbox/stats", () => {
  it("reads once and answers the week", async () => {
    const response = await GET();

    expect(readInboxStats).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(inboxStats());
  });

  it("answers a failure under this hop's code", async () => {
    readInboxStats.mockResolvedValue({
      state: "failed",
      reason: "This week's figures could not be reached.",
      pollAfterSeconds: null,
    });

    const response = await GET();

    expect(response.ok).toBe(false);
    expect(await response.json()).toMatchObject({
      code: "inbox_stats_unavailable",
      message: "This week's figures could not be reached.",
    });
  });

  it("answers a lapsed session as one, so the poll stops asking", async () => {
    readInboxStats.mockResolvedValue({ state: "gone" });

    expect((await GET()).status).toBe(401);
  });
});
