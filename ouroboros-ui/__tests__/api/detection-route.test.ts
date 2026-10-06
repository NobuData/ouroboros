import { beforeEach, describe, expect, it, vi } from "vitest";

import { POLL_AFTER_HEADER } from "@/app/poll";

import { REPO, seededCard } from "../helpers/onboarding";

/** `GET /api/onboarding/detection?repo=` (#391): the card the poll names, in the poll family's shape. */

const readDetectionPoll = vi.fn();

vi.mock("@/app/api/detection-poll", () => ({
  DETECTION_UNAVAILABLE_CODE: "detection_unavailable",
  readDetectionPoll: (repo: string | null) => readDetectionPoll(repo),
}));

const { GET } = await import("@/app/api/onboarding/detection/route");

beforeEach(() => {
  readDetectionPoll.mockReset().mockResolvedValue({ state: "fresh", payload: seededCard(), etag: null, pollAfterSeconds: 2 });
});

describe("GET /api/onboarding/detection", () => {
  it("reads the repository the query names and answers the card, with the cadence it asked for", async () => {
    const response = await GET(new Request(`http://ui.test/api/onboarding/detection?repo=${encodeURIComponent(REPO)}`));

    expect(readDetectionPoll).toHaveBeenCalledExactlyOnceWith(REPO);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(seededCard());
    expect(response.headers.get(POLL_AFTER_HEADER)).toBe("2");
  });

  it("passes a missing repository on as missing, and answers a failure under this hop's code", async () => {
    readDetectionPoll.mockResolvedValue({ state: "failed", reason: "Name the repository.", pollAfterSeconds: null });

    const response = await GET(new Request("http://ui.test/api/onboarding/detection"));

    expect(readDetectionPoll).toHaveBeenCalledWith(null);
    expect(response.ok).toBe(false);
    expect(await response.json()).toMatchObject({ code: "detection_unavailable", message: "Name the repository." });
  });
});
