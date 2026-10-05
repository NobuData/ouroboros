import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import { UNREACHABLE_QUEUE } from "@/app/inbox/queue-poll";

import { inboxQueue } from "../helpers/inbox";

/** The inbox queue, read for the `/inbox` poll (#466): the rest is `poll-read.ts`'s. */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { INBOX_QUEUE_UNAVAILABLE_CODE, readInboxQueue } = await import("@/app/api/inbox-queue");

describe("readInboxQueue", () => {
  it("reads with a deadline, and answers the queue", async () => {
    const read = vi.fn().mockResolvedValue(inboxQueue());

    const answer = await readInboxQueue(read);

    expect(read.mock.calls[0]![0]).toBeInstanceOf(AbortSignal);
    expect(answer).toEqual({ state: "fresh", payload: inboxQueue(), etag: null, pollAfterSeconds: null });
  });

  it("reads a 401 as gone and a dropped read as unreachable", async () => {
    expect(await readInboxQueue(vi.fn().mockRejectedValue(new ApiError(401, "unauthenticated", "Sign in.")))).toEqual({
      state: "gone",
    });
    expect(await readInboxQueue(vi.fn().mockRejectedValue(new TypeError("fetch failed")))).toEqual({
      state: "failed",
      reason: UNREACHABLE_QUEUE,
      pollAfterSeconds: null,
    });
  });

  it("reports under this hop's own code", () => {
    expect(INBOX_QUEUE_UNAVAILABLE_CODE).toBe("inbox_queue_unavailable");
  });
});
