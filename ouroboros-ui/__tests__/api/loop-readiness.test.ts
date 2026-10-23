import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import { UNREACHABLE_READINESS } from "@/app/get-started/readiness-view";

import { READINESS_REPO, readiness } from "../helpers/readiness";

/**
 * Step 4's readiness hop (DK.2, #1319): the query read from the request, nothing forwarded for
 * a query REST would refuse, and one read with a deadline.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { LOOP_READINESS_QUERY_MISSING, LOOP_READINESS_UNAVAILABLE_CODE, readLoopReadiness, readinessQuery } =
  await import("@/app/api/loop-readiness");

/** Search parameters from a query string. */
const params = (query: string) => new URLSearchParams(query);

describe("readinessQuery", () => {
  it("reads the repository, the workflow and an optional issue", () => {
    expect(readinessQuery(params(`repository=${READINESS_REPO}&workflow=quick-fixes`))).toEqual({
      repository: READINESS_REPO,
      workflow: "quick-fixes",
    });
    expect(readinessQuery(params(`repository=${READINESS_REPO}&workflow=quick-fixes&issue=488`))).toEqual({
      repository: READINESS_REPO,
      workflow: "quick-fixes",
      issue: 488,
    });
  });

  it.each([
    "workflow=quick-fixes",
    `repository=${READINESS_REPO}`,
    "repository=helios&workflow=quick-fixes",
    `repository=${READINESS_REPO}&workflow=Quick Fixes`,
    `repository=${READINESS_REPO}&workflow=quick-fixes&issue=0`,
    `repository=${READINESS_REPO}&workflow=quick-fixes&issue=4.5`,
    `repository=${READINESS_REPO}&workflow=quick-fixes&issue=x`,
  ])("refuses %s", (query) => {
    expect(readinessQuery(params(query))).toBeNull();
  });
});

describe("readLoopReadiness", () => {
  it("reads the query with a deadline, and answers the preflight", async () => {
    const read = vi.fn().mockResolvedValue(readiness());
    const query = { repository: READINESS_REPO, workflow: "quick-fixes" };

    expect(await readLoopReadiness(query, read)).toEqual({
      state: "fresh",
      payload: readiness(),
      etag: null,
      pollAfterSeconds: null,
    });
    expect(read.mock.calls[0]![0]).toEqual(query);
    expect(read.mock.calls[0]![1]).toBeInstanceOf(AbortSignal);
  });

  it("forwards nothing without a query", async () => {
    const read = vi.fn();

    expect(await readLoopReadiness(null, read)).toEqual({
      state: "failed",
      reason: LOOP_READINESS_QUERY_MISSING,
      pollAfterSeconds: null,
    });
    expect(read).not.toHaveBeenCalled();
  });

  it("reads a 401 as gone, a REST refusal in its own words, and a dropped read as unreachable", async () => {
    const query = { repository: READINESS_REPO, workflow: "quick-fixes" };

    expect(await readLoopReadiness(query, vi.fn().mockRejectedValue(new ApiError(401, "unauthenticated", "Sign in.")))).toEqual({
      state: "gone",
    });
    expect(
      await readLoopReadiness(
        query,
        vi.fn().mockRejectedValue(new ApiError(404, "repository_not_found", "The workspace has no repository acme/x.")),
      ),
    ).toMatchObject({ state: "failed", reason: "The workspace has no repository acme/x." });
    expect(await readLoopReadiness(query, vi.fn().mockRejectedValue(new TypeError("fetch failed")))).toMatchObject({
      state: "failed",
      reason: UNREACHABLE_READINESS,
    });
    expect(LOOP_READINESS_UNAVAILABLE_CODE).toBe("loop_readiness_unavailable");
  });
});
