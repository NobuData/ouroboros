import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import { UNREACHABLE_FIRST_ISSUE } from "@/app/get-started/first-issue-view";

import { REPO, firstIssueCard } from "../helpers/onboarding";

/**
 * The first-issue card's poll hop (#393): one read with a deadline, and nothing forwarded for
 * what is not a repository.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { FIRST_ISSUE_REPO_MISSING, FIRST_ISSUE_UNAVAILABLE_CODE, readFirstIssuePoll } = await import("@/app/api/first-issue-poll");

describe("readFirstIssuePoll", () => {
  it("reads the repository with a deadline, and answers the card", async () => {
    const read = vi.fn().mockResolvedValue(firstIssueCard());

    expect(await readFirstIssuePoll(REPO, read)).toEqual({
      state: "fresh",
      payload: firstIssueCard(),
      etag: null,
      pollAfterSeconds: null,
    });
    expect(read.mock.calls[0]![0]).toBe(REPO);
    expect(read.mock.calls[0]![1]).toBeInstanceOf(AbortSignal);
  });

  it.each([null, undefined, "", "helios-firmware", "a/b/c"])("never forwards %j — it is not a repository", async (repo) => {
    const read = vi.fn();

    expect(await readFirstIssuePoll(repo, read)).toEqual({
      state: "failed",
      reason: FIRST_ISSUE_REPO_MISSING,
      pollAfterSeconds: null,
    });
    expect(read).not.toHaveBeenCalled();
  });

  it("reads a 401 as gone and a dropped read as unreachable, under this hop's code", async () => {
    expect(await readFirstIssuePoll(REPO, vi.fn().mockRejectedValue(new ApiError(401, "unauthenticated", "Sign in.")))).toEqual({
      state: "gone",
    });
    expect(await readFirstIssuePoll(REPO, vi.fn().mockRejectedValue(new TypeError("fetch failed")))).toMatchObject({
      state: "failed",
      reason: UNREACHABLE_FIRST_ISSUE,
    });
    expect(FIRST_ISSUE_UNAVAILABLE_CODE).toBe("first_issue_unavailable");
  });
});
