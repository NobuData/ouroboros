import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import { UNREACHABLE_INBOX } from "@/app/shell/inbox-poll";

/** The inbox feed, read for the badge's poll (#461): the rest is `poll-read.ts`'s. */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { INBOX_UNAVAILABLE_CODE, readInboxFeed } = await import("@/app/api/inbox-feed");

const FEED = {
  open: 3,
  bySeverity: { err: 1, warn: 2, info: 0 },
  snoozed: 0,
  nextWakeAt: null,
  asOf: "2026-10-04T09:12:00.000Z",
};

describe("readInboxFeed", () => {
  it("reads with a deadline, and answers the feed", async () => {
    const read = vi.fn().mockResolvedValue(FEED);

    const answer = await readInboxFeed(read);

    expect(read.mock.calls[0]![0]).toBeInstanceOf(AbortSignal);
    expect(answer).toEqual({ state: "fresh", payload: FEED, etag: null, pollAfterSeconds: null });
  });

  it("reads a 401 as gone, a refusal as the service's sentence, and a dropped read as unreachable", async () => {
    expect(await readInboxFeed(vi.fn().mockRejectedValue(new ApiError(401, "unauthenticated", "Sign in.")))).toEqual({
      state: "gone",
    });
    expect(
      await readInboxFeed(vi.fn().mockRejectedValue(new ApiError(400, "organization_required", "Choose a workspace."))),
    ).toEqual({ state: "failed", reason: "Choose a workspace.", pollAfterSeconds: null });
    expect(await readInboxFeed(vi.fn().mockRejectedValue(new TypeError("fetch failed")))).toEqual({
      state: "failed",
      reason: UNREACHABLE_INBOX,
      pollAfterSeconds: null,
    });
  });

  it("reports under this hop's own code", () => {
    expect(INBOX_UNAVAILABLE_CODE).toBe("inbox_unavailable");
  });
});
