import { beforeEach, describe, expect, it, vi } from "vitest";

import { REPO, selfHostedDefaults } from "../helpers/onboarding";

/** `GET /api/onboarding/defaults?repo=` (#394): the column the poll names, in the poll family's shape. */

const readDefaultsPoll = vi.fn();

vi.mock("@/app/api/defaults-poll", () => ({
  DEFAULTS_UNAVAILABLE_CODE: "onboarding_defaults_unavailable",
  readDefaultsPoll: (repo: string | null) => readDefaultsPoll(repo),
}));

const { GET } = await import("@/app/api/onboarding/defaults/route");

beforeEach(() => {
  readDefaultsPoll.mockReset().mockResolvedValue({ state: "fresh", payload: selfHostedDefaults(), etag: null, pollAfterSeconds: null });
});

describe("GET /api/onboarding/defaults", () => {
  it("reads the repository the query names and answers the column", async () => {
    const response = await GET(new Request(`http://ui.test/api/onboarding/defaults?repo=${encodeURIComponent(REPO)}`));

    expect(readDefaultsPoll).toHaveBeenCalledExactlyOnceWith(REPO);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(selfHostedDefaults());
  });

  it("passes a missing repository on as missing, and answers a failure under this hop's code", async () => {
    readDefaultsPoll.mockResolvedValue({ state: "failed", reason: "Name the repository.", pollAfterSeconds: null });

    const response = await GET(new Request("http://ui.test/api/onboarding/defaults"));

    expect(readDefaultsPoll).toHaveBeenCalledWith(null);
    expect(response.ok).toBe(false);
    expect(await response.json()).toMatchObject({ code: "onboarding_defaults_unavailable", message: "Name the repository." });
  });
});
