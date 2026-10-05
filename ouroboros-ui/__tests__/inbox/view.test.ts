import { describe, expect, it } from "vitest";

import {
  NOTHING_TO_SNOOZE,
  STALE_HEADLINE,
  VIEWER_CANNOT_SNOOZE,
  askedAgo,
  lastRefreshedAt,
  refreshedTime,
  staleHeadline,
  decisions,
  maySnoozeAll,
  snoozeAllReason,
  snoozeConfirmation,
  snoozedUntil,
} from "@/app/inbox/view";
import {
  draftOf,
  draftProblem,
  nextDigestLine,
  utcMinute,
} from "@/app/inbox/notifications-view";

import { INBOX_READ_AT, inboxItem, preferences, snoozedItem, utcClock } from "../helpers/inbox";

describe("the inbox frame's rules (#466)", () => {
  it("counts in the singular at one", () => {
    expect(decisions(1)).toBe("1 decision");
    expect(decisions(3)).toBe("3 decisions");
  });

  it("names how many and until when before snoozing", () => {
    expect(snoozeConfirmation(3, INBOX_READ_AT, utcClock)).toEqual({
      title: "Snooze 3 decisions until 14:20?",
      warning:
        "They leave the queue and the Needs You badge until 14:20, then come back on their own. How long the loops have waited keeps counting.",
      confirm: "Snooze until 14:20",
    });
    expect(snoozeConfirmation(1, INBOX_READ_AT, utcClock).warning).toMatch(/^It leaves/);
  });

  it("is inert at zero, then for a reader who may not snooze", () => {
    expect(snoozeAllReason(0, true)).toBe(NOTHING_TO_SNOOZE);
    expect(snoozeAllReason(0, false)).toBe(NOTHING_TO_SNOOZE);
    expect(snoozeAllReason(2, false)).toBe(VIEWER_CANNOT_SNOOZE);
    expect(snoozeAllReason(2, true)).toBeUndefined();
  });

  it("reads the snooze permission from the items", () => {
    expect(maySnoozeAll([])).toBe(false);
    expect(maySnoozeAll([inboxItem()])).toBe(true);
    expect(maySnoozeAll([inboxItem({ snooze: { allowed: false } })])).toBe(false);
  });

  it("ages rows and wakes snoozed ones", () => {
    expect(askedAgo(360)).toBe("asked 6m ago");
    expect(snoozedUntil(snoozedItem(), utcClock)).toBe("until 14:20");
  });
});

describe("the preferences sheet's rules (#466)", () => {
  it("opens on the service's values", () => {
    expect(draftOf(preferences({ mutedKinds: ["fact_review"] }))).toEqual({
      digestEnabled: false,
      digestTime: "09:00",
      instant: true,
      mutedKinds: ["fact_review"],
    });
  });

  it("accepts only HH:MM", () => {
    const draft = draftOf(preferences());

    expect(draftProblem(draft)).toBeUndefined();
    for (const time of ["9:00", "24:00", "09:60", "0900", ""]) {
      expect(draftProblem({ ...draft, digestTime: time })).toBeDefined();
    }
  });

  it("says when the next digest leaves, or that it is off", () => {
    expect(nextDigestLine(preferences(), utcMinute)).toBe("Off — nothing is mailed daily.");
    expect(
      nextDigestLine(
        preferences({ digest: { enabled: true, time: "09:00", timeZone: "UTC", nextSendAt: "2026-10-05T09:00:00.000Z" } }),
        utcMinute,
      ),
    ).toBe("Next digest 2026-10-05 09:00 UTC");
  });
});

describe("the lag banner (#470)", () => {
  const AS_OF = Date.parse("2026-10-04T10:42:13.000Z");

  /** A fixed stamp: the instant as UTC `HH:MM:SS`. */
  const stamp = (atMs: number) => new Date(atMs).toISOString().slice(11, 19);

  it("prints when the queue on screen was last refreshed, to the second", () => {
    expect(staleHeadline(AS_OF, stamp)).toBe(`${STALE_HEADLINE} Last refreshed 10:42:13.`);
  });

  it("says only that it could not be refreshed when no queue was ever read", () => {
    expect(staleHeadline(null, stamp)).toBe(STALE_HEADLINE);
  });

  it("takes the queue's own asOf, or the poll's later confirmation of it", () => {
    expect(lastRefreshedAt({ asOf: "2026-10-04T10:42:13.000Z" }, null)).toBe(AS_OF);
    expect(lastRefreshedAt({ asOf: "2026-10-04T10:42:13.000Z" }, AS_OF + 15_000)).toBe(AS_OF + 15_000);
    expect(lastRefreshedAt({ asOf: "2026-10-04T10:42:13.000Z" }, AS_OF - 15_000)).toBe(AS_OF);
  });

  it("knows nothing about a queue it never read, or an asOf it cannot parse with no confirmation", () => {
    expect(lastRefreshedAt(null, AS_OF)).toBeNull();
    expect(lastRefreshedAt({ asOf: "later" }, null)).toBeNull();
    expect(lastRefreshedAt({ asOf: "later" }, AS_OF)).toBe(AS_OF);
  });

  it("prints the reader's clock with seconds", () => {
    expect(refreshedTime(AS_OF)).toBe(
      new Date(AS_OF).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    );
  });
});
