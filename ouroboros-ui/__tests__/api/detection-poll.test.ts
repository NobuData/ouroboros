import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import { UNREACHABLE_DETECTION } from "@/app/get-started/detection-view";
import { DEFAULT_POLL_SECONDS } from "@/app/poll";

import { REPO, scanProgress, seededCard } from "../helpers/onboarding";

/**
 * The detection card's poll hop (#391): one read with a deadline, fast while a scan runs and back
 * to the family's default once it is not, and nothing forwarded for what is not a repository.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { DETECTION_REPO_MISSING, DETECTION_UNAVAILABLE_CODE, SCANNING_POLL_SECONDS, readDetectionPoll } =
  await import("@/app/api/detection-poll");

describe("readDetectionPoll", () => {
  it("reads the repository with a deadline, at the family's default cadence while nothing runs", async () => {
    const read = vi.fn().mockResolvedValue(seededCard());

    expect(await readDetectionPoll(REPO, read)).toEqual({
      state: "fresh",
      payload: seededCard(),
      etag: null,
      pollAfterSeconds: DEFAULT_POLL_SECONDS,
    });
    expect(read.mock.calls[0]![0]).toBe(REPO);
    expect(read.mock.calls[0]![1]).toBeInstanceOf(AbortSignal);
  });

  it("asks to be read again quickly while a scan runs — the progress line moves", async () => {
    const read = vi.fn().mockResolvedValue(seededCard({ progress: scanProgress() }));

    expect(await readDetectionPoll(REPO, read)).toMatchObject({ pollAfterSeconds: SCANNING_POLL_SECONDS });
    expect(SCANNING_POLL_SECONDS).toBeLessThan(DEFAULT_POLL_SECONDS);
  });

  it("slows back down once the scan is done or failed", async () => {
    for (const state of ["done", "failed"] as const) {
      const read = vi.fn().mockResolvedValue(seededCard({ progress: scanProgress({ state }) }));

      expect(await readDetectionPoll(REPO, read)).toMatchObject({ pollAfterSeconds: DEFAULT_POLL_SECONDS });
    }
  });

  it.each([null, undefined, "", "helios-firmware", "a/b/c"])("never forwards %j — it is not a repository", async (repo) => {
    const read = vi.fn();

    expect(await readDetectionPoll(repo, read)).toEqual({
      state: "failed",
      reason: DETECTION_REPO_MISSING,
      pollAfterSeconds: null,
    });
    expect(read).not.toHaveBeenCalled();
  });

  it("reads a 401 as gone and a dropped read as unreachable, under this hop's code", async () => {
    expect(
      await readDetectionPoll(REPO, vi.fn().mockRejectedValue(new ApiError(401, "unauthenticated", "Sign in."))),
    ).toEqual({ state: "gone" });
    expect(await readDetectionPoll(REPO, vi.fn().mockRejectedValue(new TypeError("fetch failed")))).toMatchObject({
      state: "failed",
      reason: UNREACHABLE_DETECTION,
    });
    expect(DETECTION_UNAVAILABLE_CODE).toBe("detection_unavailable");
  });
});
