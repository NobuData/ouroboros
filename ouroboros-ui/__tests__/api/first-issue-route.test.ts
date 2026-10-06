import { beforeEach, describe, expect, it, vi } from "vitest";

import { REPO, firstIssueCard } from "../helpers/onboarding";

/** `GET /api/onboarding/first-issue?repo=` (#393): the card the poll names, in the poll family's shape. */

const readFirstIssuePoll = vi.fn();

vi.mock("@/app/api/first-issue-poll", () => ({
  FIRST_ISSUE_UNAVAILABLE_CODE: "first_issue_unavailable",
  readFirstIssuePoll: (repo: string | null) => readFirstIssuePoll(repo),
}));

const { GET } = await import("@/app/api/onboarding/first-issue/route");

beforeEach(() => {
  readFirstIssuePoll.mockReset().mockResolvedValue({ state: "fresh", payload: firstIssueCard(), etag: null, pollAfterSeconds: null });
});

describe("GET /api/onboarding/first-issue", () => {
  it("reads the repository the query names and answers the card", async () => {
    const response = await GET(new Request(`http://ui.test/api/onboarding/first-issue?repo=${encodeURIComponent(REPO)}`));

    expect(readFirstIssuePoll).toHaveBeenCalledExactlyOnceWith(REPO);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(firstIssueCard());
  });

  it("passes a missing repository on as missing, and answers a failure under this hop's code", async () => {
    readFirstIssuePoll.mockResolvedValue({ state: "failed", reason: "Name the repository.", pollAfterSeconds: null });

    const response = await GET(new Request("http://ui.test/api/onboarding/first-issue"));

    expect(readFirstIssuePoll).toHaveBeenCalledWith(null);
    expect(response.ok).toBe(false);
    expect(await response.json()).toMatchObject({ code: "first_issue_unavailable", message: "Name the repository." });
  });
});
