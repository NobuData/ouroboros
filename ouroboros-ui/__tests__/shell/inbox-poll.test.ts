import { afterEach, describe, expect, it, vi } from "vitest";

import type { InboxFeed } from "@/app/api/inbox";
import { EMPTY_POLL_SNAPSHOT, SESSION_ENDED } from "@/app/poll";
import {
  INBOX_FEED_ENDPOINT,
  UNREADABLE_INBOX,
  createInboxPoll,
  inboxBadgeCount,
  isInboxFeed,
  requestInboxFeed,
} from "@/app/shell/inbox-poll";

/** The Needs-You badge's poll (#461): this origin's feed, a guard on what answered, the count. */

/** A feed as the service sends it — mockup 16's three decisions. */
function feed(overrides: Partial<InboxFeed> = {}): InboxFeed {
  return {
    open: 3,
    bySeverity: { err: 1, warn: 2, info: 0 },
    snoozed: 0,
    nextWakeAt: null,
    asOf: "2026-10-04T09:12:00.000Z",
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isInboxFeed", () => {
  it("accepts the feed, a snoozed one included", () => {
    expect(isInboxFeed(feed())).toBe(true);
    expect(isInboxFeed(feed({ open: 0, bySeverity: { err: 0, warn: 0, info: 0 }, snoozed: 2 }))).toBe(true);
  });

  it("refuses what the badge could not draw honestly", () => {
    expect(isInboxFeed(null)).toBe(false);
    expect(isInboxFeed({})).toBe(false);
    expect(isInboxFeed({ ...feed(), open: "3" })).toBe(false);
    expect(isInboxFeed({ ...feed(), open: -1 })).toBe(false);
    expect(isInboxFeed({ ...feed(), open: 1.5 })).toBe(false);
    expect(isInboxFeed({ ...feed(), bySeverity: null })).toBe(false);
    expect(isInboxFeed({ ...feed(), bySeverity: { err: 1, warn: 2 } })).toBe(false);
    expect(isInboxFeed({ ...feed(), snoozed: undefined })).toBe(false);
  });
});

describe("requestInboxFeed", () => {
  it("asks this origin, not the service, and reads the feed", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(feed()), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetch);

    const answer = await requestInboxFeed(null);

    expect(fetch.mock.calls[0]![0]).toBe(INBOX_FEED_ENDPOINT);
    expect(INBOX_FEED_ENDPOINT).toBe("/api/inbox/feed");
    expect(answer).toMatchObject({ state: "fresh", payload: feed() });
  });

  it("calls a body that is not the feed unreadable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ count: 3 }), { status: 200, headers: { "Content-Type": "application/json" } }),
      ),
    );

    expect(await requestInboxFeed(null)).toMatchObject({ state: "failed", reason: UNREADABLE_INBOX });
  });
});

describe("inboxBadgeCount", () => {
  it("is null — nobody has counted — before the first answer", () => {
    expect(inboxBadgeCount(EMPTY_POLL_SNAPSHOT)).toBeNull();
  });

  it("is the open count, zero included, once the feed has answered", () => {
    expect(inboxBadgeCount({ data: feed(), updatedAt: 1, error: null })).toBe(3);
    expect(inboxBadgeCount({ data: feed({ open: 0 }), updatedAt: 1, error: null })).toBe(0);
  });

  it("never counts snoozed items", () => {
    expect(inboxBadgeCount({ data: feed({ open: 1, snoozed: 4 }), updatedAt: 1, error: null })).toBe(1);
  });

  it("keeps the last count through a failed ask, and withdraws it when the session ends", () => {
    expect(inboxBadgeCount({ data: feed(), updatedAt: 1, error: "The Needs-You count could not be reached." })).toBe(3);
    expect(inboxBadgeCount({ data: feed(), updatedAt: 1, error: SESSION_ENDED })).toBeNull();
  });
});

describe("createInboxPoll", () => {
  it("is inert until started, and reads through the seam it is given", async () => {
    const read = vi.fn().mockResolvedValue({ state: "fresh", payload: feed(), etag: null, pollAfterSeconds: null });
    const poll = createInboxPoll({ read, visible: () => true });

    expect(read).not.toHaveBeenCalled();

    const stop = poll.start();
    await vi.waitFor(() => expect(poll.snapshot().data).toEqual(feed()));
    stop();
  });
});
