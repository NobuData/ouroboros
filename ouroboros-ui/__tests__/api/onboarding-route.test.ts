import { beforeEach, describe, expect, it, vi } from "vitest";

import { REPO, wizard } from "../helpers/onboarding";

/** `GET /api/onboarding?repo=` (#390): the repository the poll names, answered in the poll family's shape. */

const readOnboardingPoll = vi.fn();

vi.mock("@/app/api/onboarding-poll", () => ({
  ONBOARDING_UNAVAILABLE_CODE: "onboarding_unavailable",
  readOnboardingPoll: (repo: string | null) => readOnboardingPoll(repo),
}));

const { GET } = await import("@/app/api/onboarding/route");

beforeEach(() => {
  readOnboardingPoll.mockReset().mockResolvedValue({ state: "fresh", payload: wizard(), etag: null, pollAfterSeconds: null });
});

describe("GET /api/onboarding", () => {
  it("reads the repository the query names and answers the wizard", async () => {
    const response = await GET(new Request(`http://ui.test/api/onboarding?repo=${encodeURIComponent(REPO)}`));

    expect(readOnboardingPoll).toHaveBeenCalledExactlyOnceWith(REPO);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(wizard());
  });

  it("passes a missing repository on as missing, and answers a failure under this hop's code", async () => {
    readOnboardingPoll.mockResolvedValue({ state: "failed", reason: "Name the repository.", pollAfterSeconds: null });

    const response = await GET(new Request("http://ui.test/api/onboarding"));

    expect(readOnboardingPoll).toHaveBeenCalledWith(null);
    expect(response.ok).toBe(false);
    expect(await response.json()).toMatchObject({ code: "onboarding_unavailable", message: "Name the repository." });
  });
});
