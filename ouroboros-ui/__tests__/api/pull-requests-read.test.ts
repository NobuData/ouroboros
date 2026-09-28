import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import { UNREACHABLE_PAGE } from "@/app/prs/poll";

import { PR_514_ID, prPage } from "../helpers/pull-requests";

/**
 * The PR verification page's read, for its poll (#363): the translation is `poll-read.ts`'s, the
 * cadence the shared default, and a page asked of something that is not an id is refused before
 * the service is called.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { PR_ID_INVALID, readPageForPoll } = await import("@/app/api/pull-requests-read");

describe("readPageForPoll", () => {
  it("hands the read the PR and a deadline, and answers fresh on the shared cadence", async () => {
    const read = vi.fn().mockResolvedValue(prPage());

    expect(await readPageForPoll(PR_514_ID, read)).toEqual({
      state: "fresh",
      payload: prPage(),
      etag: null,
      pollAfterSeconds: null,
    });
    expect(read.mock.calls[0]![0]).toBe(PR_514_ID);
    expect(read.mock.calls[0]![1]).toBeInstanceOf(AbortSignal);
  });

  it("refuses an id that is not a uuid without calling out", async () => {
    const read = vi.fn();

    for (const id of ["..", "514", `${PR_514_ID}/../x`]) {
      expect(await readPageForPoll(id, read)).toEqual({
        state: "failed",
        reason: PR_ID_INVALID,
        pollAfterSeconds: null,
      });
    }
    expect(read).not.toHaveBeenCalled();
  });

  it("reads a 401 as gone, a refusal in the service's words, and a dropped read in its own", async () => {
    expect(
      await readPageForPoll(
        PR_514_ID,
        vi.fn().mockRejectedValue(new ApiError(401, "unauthenticated", "Sign in.")),
      ),
    ).toEqual({ state: "gone" });
    expect(
      await readPageForPoll(
        PR_514_ID,
        vi.fn().mockRejectedValue(new ApiError(404, "pull_request_not_found", "No such PR.")),
      ),
    ).toEqual({ state: "failed", reason: "No such PR.", pollAfterSeconds: null });
    expect(
      await readPageForPoll(PR_514_ID, vi.fn().mockRejectedValue(new TypeError("fetch failed"))),
    ).toEqual({ state: "failed", reason: UNREACHABLE_PAGE, pollAfterSeconds: null });
  });
});
