import { describe, expect, it, vi } from "vitest";

import {
  INBOX_RESOLVED_ENDPOINT,
  createResolvedPoll,
  isInboxResolved,
  resolvedEndpoint,
} from "@/app/inbox/resolved-poll";

import { resolvedDay } from "../helpers/inbox";

/** The resolved list's poll (#468): one endpoint per day, and a guard on what comes back. */

describe("where a day is asked for", () => {
  it("is this origin's route — bare for today, with the day for any other", () => {
    expect(resolvedEndpoint(null)).toBe("/api/inbox/resolved");
    expect(resolvedEndpoint("2026-10-02")).toBe("/api/inbox/resolved?day=2026-10-02");
    expect(INBOX_RESOLVED_ENDPOINT).toBe("/api/inbox/resolved");
  });

  it("asks for today rather than send something that is not a date", () => {
    expect(resolvedEndpoint("yesterday")).toBe("/api/inbox/resolved");
    expect(resolvedEndpoint("2026-10-02&x=1")).toBe("/api/inbox/resolved");
  });
});

describe("what counts as a day", () => {
  it("accepts the service's answer", () => {
    expect(isInboxResolved(resolvedDay())).toBe(true);
    expect(isInboxResolved(resolvedDay({ rows: [], previousDay: null }))).toBe(true);
  });

  it.each([null, "x", {}, { day: "2026-10-04" }, { ...resolvedDay(), rows: "none" }, { ...resolvedDay(), nextDay: 4 }])(
    "refuses %j",
    (value) => {
      expect(isInboxResolved(value)).toBe(false);
    },
  );
});

describe("a day's poll", () => {
  it("reads its own endpoint", async () => {
    const read = vi.fn().mockResolvedValue({ state: "fresh", payload: resolvedDay(), etag: null, pollAfterSeconds: null });
    const poll = createResolvedPoll("/api/inbox/resolved?day=2026-10-02", { read, visible: () => true });
    const stop = poll.start();

    await vi.waitFor(() => expect(poll.snapshot().data).toEqual(resolvedDay()));
    stop();

    expect(read).toHaveBeenCalledWith("/api/inbox/resolved?day=2026-10-02", null);
  });
});
