import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import { UNREACHABLE_ISSUE } from "@/app/issues/detail-poll";

import { issueDetail, issueId } from "../helpers/issues";

/**
 * One issue, read for the detail panel's poll (#119).
 *
 * The server's half of the poll, over the shared translation (`poll-read.test.ts` holds that on
 * its own): the read is the seam, so each case is one outcome in and one answer out.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { readIssueDetail } = await import("@/app/api/backlog-detail");

const ID = issueId(485);

describe("readIssueDetail", () => {
  it("hands the read the id unchanged, with a deadline, and answers fresh with what came back", async () => {
    const read = vi.fn().mockResolvedValue(issueDetail());

    const answer = await readIssueDetail(ID, read);

    expect(read).toHaveBeenCalledOnce();
    expect(read.mock.calls[0]![0]).toBe(ID);
    expect(read.mock.calls[0]![1]).toBeInstanceOf(AbortSignal);
    expect(answer).toEqual({ state: "fresh", payload: issueDetail(), etag: null, pollAfterSeconds: null });
  });

  it("reads a 401 as the session being gone, rather than redirecting", async () => {
    const read = vi.fn().mockRejectedValue(new ApiError(401, "unauthenticated", "Sign in."));

    expect(await readIssueDetail(ID, read)).toEqual({ state: "gone" });
  });

  it("carries the service's own sentence for a refusal — an id this workspace cannot see above all", async () => {
    const read = vi.fn().mockRejectedValue(new ApiError(404, "issue_not_found", "No issue with that id."));

    expect(await readIssueDetail(ID, read)).toEqual({
      state: "failed",
      reason: "No issue with that id.",
      pollAfterSeconds: null,
    });
  });

  it("says the issue is unreachable for a read that never reached the service", async () => {
    for (const failure of [new TypeError("fetch failed"), new DOMException("timed out", "TimeoutError")]) {
      const read = vi.fn().mockRejectedValue(failure);

      expect(await readIssueDetail(ID, read)).toEqual({
        state: "failed",
        reason: UNREACHABLE_ISSUE,
        pollAfterSeconds: null,
      });
    }
  });
});
