import { beforeEach, describe, expect, it, vi } from "vitest";

import { REPO, seededTiles } from "../helpers/onboarding";

/** `GET /api/onboarding/templates?repo=` (#392): the tiles the poll names, in the poll family's shape. */

const readTemplatesPoll = vi.fn();

vi.mock("@/app/api/templates-poll", () => ({
  TEMPLATES_UNAVAILABLE_CODE: "templates_unavailable",
  readTemplatesPoll: (repo: string | null) => readTemplatesPoll(repo),
}));

const { GET } = await import("@/app/api/onboarding/templates/route");

beforeEach(() => {
  readTemplatesPoll
    .mockReset()
    .mockResolvedValue({
      state: "fresh",
      payload: seededTiles(),
      etag: null,
      pollAfterSeconds: null,
    });
});

describe("GET /api/onboarding/templates", () => {
  it("reads the repository the query names and answers the tiles", async () => {
    const response = await GET(
      new Request(`http://ui.test/api/onboarding/templates?repo=${encodeURIComponent(REPO)}`),
    );

    expect(readTemplatesPoll).toHaveBeenCalledExactlyOnceWith(REPO);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(seededTiles());
  });

  it("passes a missing repository on as missing, and answers a failure under this hop's code", async () => {
    readTemplatesPoll.mockResolvedValue({
      state: "failed",
      reason: "Name the repository.",
      pollAfterSeconds: null,
    });

    const response = await GET(new Request("http://ui.test/api/onboarding/templates"));

    expect(readTemplatesPoll).toHaveBeenCalledWith(null);
    expect(response.ok).toBe(false);
    expect(await response.json()).toMatchObject({
      code: "templates_unavailable",
      message: "Name the repository.",
    });
  });
});
