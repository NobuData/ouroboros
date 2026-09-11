import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import { UNREACHABLE_BACKLOG } from "@/app/issues/backlog-poll";

import { backlogListing } from "../helpers/issues";

/**
 * One page of the backlog, read for the table's poll (#117).
 *
 * The server's half of the poll: it answers in the loop's four cases and never throws, because
 * a route handler answering a poll has nobody behind it to catch anything. The read is the seam
 * — what the typed client would have done is `backlog.test.ts`'s — so each case is one outcome in
 * and one answer out.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { BACKLOG_TIMEOUT_MS, readBacklogPage } = await import("@/app/api/backlog-page");

const QUERY = { state: "open" as const, sort: "effort" as const, limit: 25, offset: 25 };

describe("readBacklogPage", () => {
  it("hands the read the query unchanged, with a deadline, and answers fresh with what came back", async () => {
    const read = vi.fn().mockResolvedValue(backlogListing());

    const answer = await readBacklogPage(QUERY, read);

    expect(read).toHaveBeenCalledOnce();
    expect(read.mock.calls[0]![0]).toEqual(QUERY);
    expect(read.mock.calls[0]![1]).toBeInstanceOf(AbortSignal);
    expect(answer).toEqual({ state: "fresh", payload: backlogListing(), etag: null, pollAfterSeconds: null });
  });

  it("keeps its deadline inside the poll's cadence", () => {
    expect(BACKLOG_TIMEOUT_MS).toBeLessThan(15_000);
  });

  it("reads a 401 as the session being gone, rather than redirecting", async () => {
    const read = vi.fn().mockRejectedValue(new ApiError(401, "unauthenticated", "Sign in."));

    expect(await readBacklogPage(QUERY, read)).toEqual({ state: "gone" });
  });

  it("carries the service's own sentence for any other refusal", async () => {
    const read = vi.fn().mockRejectedValue(new ApiError(503, "unavailable", "The database is not answering."));

    expect(await readBacklogPage(QUERY, read)).toEqual({
      state: "failed",
      reason: "The database is not answering.",
      pollAfterSeconds: null,
    });
  });

  it("says unreachable for a read that never reached the service — a dropped connection, the deadline", async () => {
    for (const failure of [new TypeError("fetch failed"), new DOMException("timed out", "TimeoutError")]) {
      const read = vi.fn().mockRejectedValue(failure);

      expect(await readBacklogPage(QUERY, read)).toEqual({
        state: "failed",
        reason: UNREACHABLE_BACKLOG,
        pollAfterSeconds: null,
      });
    }
  });
});
