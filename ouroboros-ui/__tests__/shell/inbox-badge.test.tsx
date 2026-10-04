import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { InboxFeed } from "@/app/api/inbox";
import type { PollAnswer } from "@/app/poll";
import { InboxBadgePublisher } from "@/app/shell/inbox-badge";
import { INBOX_BADGE_SOURCE } from "@/app/shell/nav-modules";
import { navRegistry, setNavBadge } from "@/app/shell/nav-registry";

/**
 * The publisher that lights the sidebar's Needs You badge from the inbox feed (#461): the count
 * is the feed's `open`, nothing is drawn before the first answer, and the count goes when the
 * shell does or the session ends.
 */

/** A fresh answer carrying `open` decisions. */
function fresh(open: number, snoozed = 0): PollAnswer<InboxFeed> {
  return {
    state: "fresh",
    payload: {
      open,
      bySeverity: { err: 0, warn: open, info: 0 },
      snoozed,
      nextWakeAt: null,
      asOf: "2026-10-04T09:12:00.000Z",
    },
    etag: null,
    pollAfterSeconds: null,
  };
}

afterEach(() => {
  setNavBadge(INBOX_BADGE_SOURCE, null);
});

describe("InboxBadgePublisher", () => {
  it("publishes nothing before the feed answers, so the badge is not drawn as zero", () => {
    const read = vi.fn(() => new Promise<PollAnswer<InboxFeed>>(() => {}));

    const { container } = render(<InboxBadgePublisher poll={{ read, visible: () => true }} />);

    expect(container.innerHTML).toBe("");
    expect(INBOX_BADGE_SOURCE in navRegistry().badges).toBe(false);
  });

  it("publishes the open count under the inbox source, leaving snoozed items out", async () => {
    const read = vi.fn().mockResolvedValue(fresh(3, 2));

    render(<InboxBadgePublisher poll={{ read, visible: () => true }} />);

    await vi.waitFor(() => expect(navRegistry().badges[INBOX_BADGE_SOURCE]).toBe(3));
  });

  it("withdraws the count when the shell goes away", async () => {
    const read = vi.fn().mockResolvedValue(fresh(1));
    const { unmount } = render(<InboxBadgePublisher poll={{ read, visible: () => true }} />);

    await vi.waitFor(() => expect(navRegistry().badges[INBOX_BADGE_SOURCE]).toBe(1));
    unmount();

    expect(INBOX_BADGE_SOURCE in navRegistry().badges).toBe(false);
  });

  it("withdraws the count when the session ends", async () => {
    const read = vi
      .fn<() => Promise<PollAnswer<InboxFeed>>>()
      .mockResolvedValueOnce(fresh(2))
      .mockResolvedValue({ state: "gone" });

    render(<InboxBadgePublisher poll={{ read, visible: () => true }} />);
    await vi.waitFor(() => expect(navRegistry().badges[INBOX_BADGE_SOURCE]).toBe(2));

    // The tab becoming visible again asks at once — and this time the service says `gone`.
    document.dispatchEvent(new Event("visibilitychange"));

    await vi.waitFor(() => expect(INBOX_BADGE_SOURCE in navRegistry().badges).toBe(false));
  });
});
